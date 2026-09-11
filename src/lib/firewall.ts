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

/**
 * Refuses to block an IP that belongs to the infrastructure itself — a host's LAN address,
 * Tailscale address, or public IP (several physical machines can share the same one, e.g. behind
 * the same Freebox/router). Blocking one of these would either be a no-op self-sabotage (a LAN
 * IP dropped on itself) or lock the panel out of a machine it manages, so this is checked before
 * any SSH command runs rather than left to fail loudly later.
 */
function findInfraOwner(ip: string): string | null {
  const row = getDb()
    .prepare(`SELECT name FROM hosts WHERE lan_ip = ? OR tailscale_ip = ? OR public_ip = ? LIMIT 1`)
    .get(ip, ip, ip) as { name: string } | undefined;
  return row?.name ?? null;
}

function assertBlockable(ip: string): void {
  const owner = findInfraOwner(ip);
  if (owner) {
    throw new Error(`${ip} est une adresse de l'infrastructure (${owner}) — blocage refusé pour éviter un auto-verrouillage.`);
  }
}

/** The Security Center treats blocking as one infra-wide action rather than per-host state — see
 * blocked_ips in lib/db.ts. */
export function recordBlockedIp(ip: string): void {
  getDb()
    .prepare(`INSERT INTO blocked_ips (ip, blocked_at) VALUES (?, datetime('now')) ON CONFLICT(ip) DO NOTHING`)
    .run(ip);
}

export function forgetBlockedIp(ip: string): void {
  getDb().prepare(`DELETE FROM blocked_ips WHERE ip = ?`).run(ip);
}

export function listBlockedIps(): { ip: string; blockedAt: string }[] {
  return (
    getDb().prepare(`SELECT ip, blocked_at as blockedAt FROM blocked_ips ORDER BY blocked_at DESC`).all() as {
      ip: string;
      blockedAt: string;
    }[]
  );
}

export type BlockEverywhereResult = { hostId: number; hostName: string; ok: boolean; message: string };

/**
 * Replicates a block across every host in the inventory instead of just the one where the IP
 * was spotted — useful since an attacker probing one machine will often move on to the next.
 * Best-effort per host: a host with no SSH access configured (a Freebox/pfSense-managed router,
 * a machine mid-setup, ...) just reports its own failure rather than aborting the whole batch.
 */
export async function blockIpEverywhere(ip: string): Promise<BlockEverywhereResult[]> {
  assertBlockable(ip);
  const hosts = getDb().prepare(`SELECT id, name FROM hosts ORDER BY kind, name`).all() as {
    id: number;
    name: string;
  }[];

  const results = await Promise.all(
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
  return results;
}

/**
 * Unblocking is always infra-wide by design (unlike blocking, which can target one host or
 * everywhere) — a false positive should disappear from every machine at once, not linger on the
 * ones the user forgot to check. Best-effort per host, same as blockIpEverywhere: a host where
 * the rule was never applied (it had no SSH access, or the IP was only ever blocked on some
 * hosts) just reports nothing to do rather than failing the batch.
 */
export async function unblockIpEverywhere(ip: string): Promise<BlockEverywhereResult[]> {
  const hosts = getDb().prepare(`SELECT id, name FROM hosts ORDER BY kind, name`).all() as {
    id: number;
    name: string;
  }[];

  const results = await Promise.all(
    hosts.map(async (host) => {
      try {
        const { message } = await unblockIp(host.id, ip);
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
  forgetBlockedIp(ip);
  return results;
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
  assertBlockable(ip);
  const result = await applyBlockIp(hostId, ip);
  recordBlockedIp(ip);
  return result;
}

async function applyBlockIp(hostId: number, ip: string): Promise<{ message: string }> {
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

/**
 * Reverses blockIp on a single host — mirrors its three OS-family branches so it removes exactly
 * what was added. Removing a rule that was never applied on this host (it was only blocked
 * elsewhere, or SSH was unreachable at block time) is treated as a no-op success rather than an
 * error, since that's the expected case for most hosts in an infra-wide unblock.
 */
export async function unblockIp(hostId: number, ip: string): Promise<{ message: string }> {
  if (!isValidIpv4(ip)) throw new Error("Adresse IP invalide.");

  const updateMethod = getHostUpdateMethod(hostId);

  if (updateMethod === "opkg") {
    const ruleName = `homelab_block_${ip.replace(/\./g, "_")}`;
    const command = [
      `RULE=${shellQuote(ruleName)}`,
      `IDX=$(uci show firewall 2>/dev/null | grep "='$RULE'" | head -n1 | cut -d. -f2)`,
      `if [ -n "$IDX" ]; then uci delete firewall.$IDX && uci commit firewall && /etc/init.d/firewall reload; fi`,
    ].join("\n");
    const { code, stderr } = await withTimeout(
      runSshCommand(hostId, command, { sudo: true }),
      BLOCK_TIMEOUT_MS,
      "Délai dépassé lors du déblocage."
    );
    if (code !== 0) throw new Error(stderr || "Échec du déblocage via uci firewall.");
    return { message: `IP ${ip} débloquée.` };
  }

  const removeCommand = `iptables -D INPUT -s ${shellQuote(ip)} -j DROP 2>/dev/null || true`;

  if (updateMethod === "apt") {
    const command = [
      removeCommand,
      `command -v netfilter-persistent >/dev/null 2>&1 && netfilter-persistent save >/dev/null 2>&1 || true`,
    ].join("\n");
    const { code, stderr } = await withTimeout(
      runSshCommand(hostId, command, { sudo: true }),
      BLOCK_TIMEOUT_MS,
      "Délai dépassé lors du déblocage."
    );
    if (code !== 0) throw new Error(stderr || "Échec du déblocage iptables.");
    return { message: `IP ${ip} débloquée.` };
  }

  const { code, stderr } = await withTimeout(
    runSshCommand(hostId, removeCommand, { sudo: true }),
    BLOCK_TIMEOUT_MS,
    "Délai dépassé lors du déblocage."
  );
  if (code !== 0) throw new Error(stderr || "Échec du déblocage iptables.");
  return { message: `IP ${ip} débloquée.` };
}
