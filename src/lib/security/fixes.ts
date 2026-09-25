import { runSshCommand } from "../ssh";
import { getDb } from "../db";
import { buildUpdateCommand, startUpdateJob, type UpdateMethod } from "../updates";
import { withTimeout } from "../timeout";
import { blockIp, blockIpEverywhere, firewallBackendScript } from "../firewall";
import { installPackageUniversal, restartService } from "../hostCompat";

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
    // Tries apt/dnf/yum/apk/pacman/zypper, then systemd/OpenRC/SysV to start it — this panel
    // targets a heterogeneous fleet, not just Debian/Ubuntu with systemd.
    await installPackageUniversal(hostId, "fail2ban");
    const { code, stderr } = await restartService(hostId, "fail2ban");
    if (code !== 0) throw new Error(stderr || "fail2ban installé, mais impossible de le démarrer sur cette machine.");
    return { message: "fail2ban installé et démarré." };
  },

  "install-unattended-upgrades": async (hostId) => {
    // The mechanism itself (not just the package name) differs per distro family — Debian/Ubuntu's
    // unattended-upgrades, RHEL/Fedora's dnf-automatic (or the older yum-cron), and no established
    // built-in equivalent at all on Alpine/Arch/openSUSE — so this is a self-contained per-distro
    // script rather than a single generic "install X" call, with an honest "not supported" outcome
    // for anything else instead of a misleading fake success.
    const command = [
      `if command -v apt-get >/dev/null 2>&1; then`,
      `  export DEBIAN_FRONTEND=noninteractive`,
      `  apt-get update && apt-get install -y unattended-upgrades && dpkg-reconfigure -f noninteractive unattended-upgrades && (systemctl enable --now unattended-upgrades 2>/dev/null || true)`,
      `  echo homelab_backend=apt`,
      `elif command -v dnf >/dev/null 2>&1; then`,
      `  dnf install -y dnf-automatic`,
      `  sed -i 's/^apply_updates.*/apply_updates = yes/' /etc/dnf/automatic.conf 2>/dev/null || true`,
      `  systemctl enable --now dnf-automatic-install.timer`,
      `  echo homelab_backend=dnf`,
      `elif command -v yum >/dev/null 2>&1; then`,
      `  yum install -y yum-cron`,
      `  sed -i 's/^apply_updates.*/apply_updates = yes/' /etc/yum/yum-cron.conf 2>/dev/null || true`,
      `  systemctl enable --now yum-cron`,
      `  echo homelab_backend=yum`,
      `else`,
      `  echo homelab_unsupported`,
      `fi`,
    ].join("\n");
    const { stdout, code, stderr } = await withTimeout(
      runSshCommand(hostId, command, { sudo: true }),
      120_000,
      "Délai dépassé lors de l'activation des mises à jour automatiques."
    );
    if (stdout.includes("homelab_unsupported")) {
      throw new Error(
        "Aucun mécanisme de mises à jour de sécurité automatiques reconnu pour cette distribution (ni apt, ni dnf/yum) — " +
          "à mettre en place manuellement (par exemple via une tâche cron planifiée exécutant la commande de mise à jour du système)."
      );
    }
    if (code !== 0) throw new Error(stderr.trim() || "Échec de l'activation des mises à jour automatiques.");
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
    // Same three-way UFW/firewalld/iptables detection as firewall.ts's blockIp/unblockIp —
    // applying raw iptables rules on a machine actually managed by UFW or firewalld risks being
    // silently overridden (or conflicting outright) on their next reload.
    const command = [
      `PORT=${sshPort}`,
      firewallBackendScript(
        [`  ufw allow "$PORT"/tcp >/dev/null 2>&1`, `  ufw --force enable >/dev/null 2>&1`].join("\n"),
        [
          `  firewall-cmd --set-default-zone=drop >/dev/null 2>&1`,
          `  firewall-cmd --permanent --add-port="$PORT"/tcp >/dev/null 2>&1`,
          `  firewall-cmd --reload >/dev/null 2>&1`,
        ].join("\n"),
        // Idempotent baseline: loopback, established/related, ICMP, and SSH stay open; everything
        // else inbound is dropped. Rules are inserted with a -C check first so re-running is safe.
        [
          `  add() { iptables -C INPUT "$@" 2>/dev/null || iptables -I INPUT "$@"; }`,
          `  add -i lo -j ACCEPT`,
          `  add -m state --state ESTABLISHED,RELATED -j ACCEPT`,
          `  add -p icmp -j ACCEPT`,
          `  add -p tcp --dport "$PORT" -j ACCEPT`,
          `  iptables -P INPUT DROP`,
          `  iptables -P FORWARD DROP`,
        ].join("\n")
      ),
    ].join("\n");
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

  "block-ip-everywhere": async (_hostId, params) => {
    const ip = params?.ip;
    if (!ip) throw new Error("Adresse IP manquante.");
    const results = await blockIpEverywhere(ip);
    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    const summary = `IP ${ip} bloquée sur ${succeeded.length}/${results.length} machine${results.length > 1 ? "s" : ""}.`;
    const detail = failed.length > 0 ? ` Échecs : ${failed.map((f) => `${f.hostName} (${f.message})`).join(", ")}` : "";
    return { message: summary + detail };
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
