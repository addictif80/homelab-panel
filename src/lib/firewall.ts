import { runSshCommand, shellQuote } from "./ssh";
import { withTimeout } from "./timeout";
import { getDb } from "./db";

const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const BLOCK_TIMEOUT_MS = 30_000;

function isValidIpv4(ip: string): boolean {
  if (!IPV4_RE.test(ip)) return false;
  return ip.split(".").every((part) => Number(part) <= 255);
}

type HostRow = { update_method: string | null };

function getHostUpdateMethod(hostId: number): string | null {
  const row = getDb().prepare(`SELECT update_method FROM hosts WHERE id = ?`).get(hostId) as
    | HostRow
    | undefined;
  return row?.update_method ?? null;
}

export type BlockEverywhereResult = { hostId: number; hostName: string; ok: boolean; message: string };

/**
 * Replicates a block across every host in the inventory instead of just the one where the IP
 * was spotted — useful since an attacker probing one machine will often move on to the next.
 * Best-effort per host: a host with no SSH access configured (a Freebox/pfSense-managed router,
 * a machine mid-setup, ...) just reports its own failure rather than aborting the whole batch.
 */
export async function blockIpEverywhere(ip: string): Promise<BlockEverywhereResult[]> {
  const hosts = getDb().prepare(`SELECT id, name FROM hosts ORDER BY kind, name`).all() as {
    id: number;
    name: string;
  }[];

  return Promise.all(
    hosts.map(async (host) => {
      try {
        const { message } = await blockIp(host.id, ip);
        return { hostId: host.id, hostName: host.name, ok: true, message };
      } catch (err) {
        return {
          hostId: host.id,
          hostName: host.name,
          ok: false,
          message: err instanceof Error ? err.message : "Erreur inconnue.",
        };
      }
    })
  );
}

/**
 * Blocks an IP on the given host and tries to make it survive a reboot, using whatever
 * mechanism fits that host's OS family (a raw iptables rule resets on reboot otherwise):
 *  - Debian/Ubuntu (apt): iptables-persistent, installed on first use if missing.
 *  - OpenWrt (opkg): a named uci firewall rule, persistent by nature since it's written
 *    straight into /etc/config/firewall.
 *  - Anything else (Synology DSM, unknown): best-effort iptables rule only, flagged as such.
 */
export async function blockIp(hostId: number, ip: string): Promise<{ message: string }> {
  if (!isValidIpv4(ip)) throw new Error("Adresse IP invalide.");

  const updateMethod = getHostUpdateMethod(hostId);

  if (updateMethod === "opkg") {
    const ruleName = `homelab_block_${ip.replace(/\./g, "_")}`;
    const command = [
      `RULE=${shellQuote(ruleName)}`,
      `IP=${shellQuote(ip)}`,
      `if ! uci show firewall 2>/dev/null | grep -q "='$RULE'"; then`,
      `  IDX=$(uci add firewall rule)`,
      `  uci set firewall.$IDX.name="$RULE"`,
      `  uci set firewall.$IDX.src='wan'`,
      `  uci set firewall.$IDX.src_ip="$IP"`,
      `  uci set firewall.$IDX.target='DROP'`,
      `  uci commit firewall`,
      `  /etc/init.d/firewall reload`,
      `fi`,
    ].join("\n");
    const { code, stderr } = await withTimeout(
      runSshCommand(hostId, command, { sudo: true }),
      BLOCK_TIMEOUT_MS,
      "Délai dépassé lors du blocage."
    );
    if (code !== 0) throw new Error(stderr || "Échec du blocage via uci firewall.");
    return { message: `IP ${ip} bloquée (règle uci persistante, survit à un redémarrage).` };
  }

  const iptablesCommand = `iptables -C INPUT -s ${shellQuote(ip)} -j DROP 2>/dev/null || iptables -I INPUT -s ${shellQuote(ip)} -j DROP`;

  if (updateMethod === "apt") {
    const command = [
      iptablesCommand,
      `if command -v netfilter-persistent >/dev/null 2>&1; then`,
      `  netfilter-persistent save >/dev/null 2>&1`,
      `else`,
      `  export DEBIAN_FRONTEND=noninteractive`,
      `  apt-get update -qq >/dev/null 2>&1 && apt-get install -y iptables-persistent >/dev/null 2>&1 && netfilter-persistent save >/dev/null 2>&1`,
      `fi`,
    ].join("\n");
    const { code, stderr } = await withTimeout(
      runSshCommand(hostId, command, { sudo: true }),
      BLOCK_TIMEOUT_MS,
      "Délai dépassé lors du blocage."
    );
    if (code !== 0) throw new Error(stderr || "Échec du blocage iptables.");
    return { message: `IP ${ip} bloquée (règle iptables persistante, survit à un redémarrage).` };
  }

  // DSM or unrecognized update method: apply a plain iptables rule, best-effort, but be honest
  // that it won't survive a reboot on this kind of machine.
  const { code, stderr } = await withTimeout(
    runSshCommand(hostId, iptablesCommand, { sudo: true }),
    BLOCK_TIMEOUT_MS,
    "Délai dépassé lors du blocage."
  );
  if (code !== 0) throw new Error(stderr || "Échec du blocage iptables.");
  return {
    message: `IP ${ip} bloquée pour la session en cours seulement : la persistance après redémarrage n'est pas gérée pour ce type de machine.`,
  };
}
