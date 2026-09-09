import { runSshCommand } from "../ssh";
import { getDb } from "../db";
import { buildUpdateCommand, startUpdateJob, type UpdateMethod } from "../updates";
import { withTimeout } from "../timeout";
import { blockIp } from "../firewall";

export type FixResult = { message: string; jobId?: string };

type FixFn = (hostId: number, params?: Record<string, string>) => Promise<FixResult>;

const FIX_TIMEOUT_MS = 30_000;

async function run(hostId: number, command: string) {
  const { code, stderr, stdout } = await withTimeout(
    runSshCommand(hostId, command, { sudo: true }),
    FIX_TIMEOUT_MS,
    "Délai dépassé lors de l'application du correctif."
  );
  if (code !== 0) throw new Error(stderr.trim() || stdout.trim() || "La commande a échoué sur la machine.");
}

export const FIX_REGISTRY: Record<string, FixFn> = {
  "install-fail2ban": async (hostId) => {
    await run(
      hostId,
      "export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y fail2ban && systemctl enable --now fail2ban"
    );
    return { message: "fail2ban installé et démarré." };
  },

  "install-unattended-upgrades": async (hostId) => {
    await run(
      hostId,
      "export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y unattended-upgrades && dpkg-reconfigure -f noninteractive unattended-upgrades && systemctl enable --now unattended-upgrades"
    );
    return { message: "Mises à jour de sécurité automatiques activées." };
  },

  "apply-updates": async (hostId) => {
    const host = getDb().prepare(`SELECT update_method FROM hosts WHERE id = ?`).get(hostId) as
      | { update_method: UpdateMethod | null }
      | undefined;
    if (!host?.update_method) throw new Error("Aucune méthode de mise à jour définie pour cette machine.");
    const command = buildUpdateCommand(host.update_method, "apply", false);
    const jobId = startUpdateJob(hostId, "apply", command);
    return { message: "Mise à jour lancée. Suis sa progression sur la page Mises à jour.", jobId };
  },

  "basic-firewall": async (hostId) => {
    const host = getDb().prepare(`SELECT ssh_port FROM hosts WHERE id = ?`).get(hostId) as
      | { ssh_port: number }
      | undefined;
    const sshPort = host?.ssh_port || 22;
    // Idempotent baseline: loopback, established/related, ICMP, and SSH stay open; everything
    // else inbound is dropped. Rules are inserted with a -C check first so re-running is safe.
    const command = [
      `add() { iptables -C INPUT $* 2>/dev/null || iptables -I INPUT $*; }`,
      `add -i lo -j ACCEPT`,
      `add -m state --state ESTABLISHED,RELATED -j ACCEPT`,
      `add -p icmp -j ACCEPT`,
      `add -p tcp --dport ${sshPort} -j ACCEPT`,
      `iptables -P INPUT DROP`,
      `iptables -P FORWARD DROP`,
    ].join(" && ");
    await run(hostId, command);
    return {
      message: `Pare-feu de base activé (SSH sur le port ${sshPort} conservé, reste du trafic entrant bloqué).`,
    };
  },

  "block-ip": async (hostId, params) => {
    const ip = params?.ip;
    if (!ip) throw new Error("Adresse IP manquante.");
    return blockIp(hostId, ip);
  },
};

export async function applySecurityFix(
  hostId: number,
  fixId: string,
  params?: Record<string, string>
): Promise<FixResult> {
  const fn = FIX_REGISTRY[fixId];
  if (!fn) throw new Error("Correctif inconnu.");
  return fn(hostId, params);
}
