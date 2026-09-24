import { runSshCommand, shellQuote } from "./ssh";
import { withTimeout } from "./timeout";
import { getDb } from "./db";
import { listContainerIps } from "./docker";

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

const DOCKER_CHECK_TIMEOUT_MS = 8_000;

/**
 * A "suspicious" IP flagged from logs is sometimes just one of your own Docker containers — its
 * internal bridge-network address showing up because the app behind a reverse proxy isn't reading
 * X-Forwarded-For, for instance. Checked per docker-enabled host, best-effort: a host that's
 * unreachable right now just can't be checked, it doesn't abort the whole lookup.
 */
async function findDockerOwner(ip: string): Promise<{ container: string; host: string } | null> {
  const dockerHosts = getDb().prepare(`SELECT id, name FROM hosts WHERE docker_enabled = 1`).all() as {
    id: number;
    name: string;
  }[];

  for (const host of dockerHosts) {
    try {
      const containers = await withTimeout(
        listContainerIps(host.id),
        DOCKER_CHECK_TIMEOUT_MS,
        "Délai dépassé lors de la vérification Docker."
      );
      const match = containers.find((c) => c.ip === ip);
      if (match) return { container: match.name, host: host.name };
    } catch {
      continue;
    }
  }
  return null;
}

/** Full infra sweep before a block — LAN/Tailscale/public host addresses first (instant, DB-only),
 * then Docker container IPs across every docker-enabled host (SSH-based, slower) — so the caller
 * can tell the user exactly what they're about to block: which machine, or which container on
 * which machine, rather than a bare "this looks like infra" refusal. */
export async function findAnyInfraOwner(ip: string): Promise<string | null> {
  const hostOwner = findInfraOwner(ip);
  if (hostOwner) return `l'adresse réseau de la machine "${hostOwner}"`;

  const dockerOwner = await findDockerOwner(ip);
  if (dockerOwner) return `le conteneur Docker "${dockerOwner.container}" sur "${dockerOwner.host}"`;

  return null;
}

async function assertBlockable(ip: string): Promise<void> {
  const owner = await findAnyInfraOwner(ip);
  if (owner) {
    throw new Error(`${ip} correspond à ${owner} — blocage refusé pour éviter un auto-verrouillage.`);
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
export async function blockIpEverywhere(
  ip: string,
  onHostResult?: (result: BlockEverywhereResult) => void
): Promise<BlockEverywhereResult[]> {
  await assertBlockable(ip);
  const hosts = getDb().prepare(`SELECT id, name FROM hosts ORDER BY kind, name`).all() as {
    id: number;
    name: string;
  }[];

  const results = await Promise.all(
    hosts.map(async (host) => {
      let result: BlockEverywhereResult;
      try {
        const { message } = await blockIp(host.id, ip);
        result = { hostId: host.id, hostName: host.name, ok: true, message };
      } catch (err) {
        result = {
          hostId: host.id,
          hostName: host.name,
          ok: false,
          message: err instanceof Error ? err.message : "Erreur inconnue.",
        };
      }
      // Fired as each host settles, not after Promise.all resolves — this is what lets a caller
      // stream real-time per-host progress instead of only learning the outcome once every host
      // (including the slowest one, up to BLOCK_TIMEOUT_MS) has finished.
      onHostResult?.(result);
      return result;
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
export async function unblockIpEverywhere(
  ip: string,
  onHostResult?: (result: BlockEverywhereResult) => void
): Promise<BlockEverywhereResult[]> {
  const hosts = getDb().prepare(`SELECT id, name FROM hosts ORDER BY kind, name`).all() as {
    id: number;
    name: string;
  }[];

  const results = await Promise.all(
    hosts.map(async (host) => {
      let result: BlockEverywhereResult;
      try {
        const { message } = await unblockIp(host.id, ip);
        result = { hostId: host.id, hostName: host.name, ok: true, message };
      } catch (err) {
        result = {
          hostId: host.id,
          hostName: host.name,
          ok: false,
          message: err instanceof Error ? err.message : "Erreur inconnue.",
        };
      }
      onHostResult?.(result);
      return result;
    })
  );
  forgetBlockedIp(ip);
  return results;
}

/**
 * Detects UFW at the top of the block/unblock command instead of assuming raw iptables: on any
 * Ubuntu box with UFW enabled (the default on Ubuntu Desktop, and common on Ubuntu Server too),
 * `iptables -I INPUT` either gets overridden by UFW's own chains or gets silently wiped out the
 * next time UFW reloads its rules from /etc/ufw/ — and on newer Debian/Ubuntu releases the
 * `iptables` binary may not even be installed at all (nftables-only by default), so the command
 * just fails outright. UFW rules are persistent by construction (stored under /etc/ufw/), so
 * there's no separate "make it survive a reboot" step needed for that branch, unlike raw iptables.
 */
function firewallBackendScript(ip: string, onUfw: string, onIptables: string): string {
  return [
    `IP=${shellQuote(ip)}`,
    `if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "^Status: active"; then`,
    onUfw,
    `else`,
    onIptables,
    `fi`,
  ].join("\n");
}

/**
 * Blocks an IP on the given host and tries to make it survive a reboot, using whatever
 * mechanism fits that host's OS family:
 *  - OpenWrt (opkg): a named uci firewall rule, persistent by nature since it's written
 *    straight into /etc/config/firewall.
 *  - UFW active (detected at runtime, not just inferred from update_method): `ufw insert`,
 *    persistent by construction.
 *  - Debian/Ubuntu (apt) without UFW: iptables-persistent, installed on first use if missing.
 *  - Anything else (Synology DSM, unknown): best-effort raw iptables rule, flagged as such.
 */
export async function blockIp(hostId: number, ip: string): Promise<{ message: string }> {
  await assertBlockable(ip);
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

  const persistApt =
    updateMethod === "apt"
      ? [
          `  if command -v netfilter-persistent >/dev/null 2>&1; then`,
          `    netfilter-persistent save >/dev/null 2>&1`,
          `  else`,
          `    export DEBIAN_FRONTEND=noninteractive`,
          `    apt-get update -qq >/dev/null 2>&1 && apt-get install -y iptables-persistent >/dev/null 2>&1 && netfilter-persistent save >/dev/null 2>&1`,
          `  fi`,
        ].join("\n")
      : "";

  const command = firewallBackendScript(
    ip,
    [
      `  ufw status numbered 2>/dev/null | grep -q "DENY.*$IP" || ufw insert 1 deny from "$IP" to any`,
      `  echo homelab_backend=ufw`,
    ].join("\n"),
    [
      `  iptables -C INPUT -s "$IP" -j DROP 2>/dev/null || iptables -I INPUT -s "$IP" -j DROP`,
      persistApt,
      `  echo homelab_backend=iptables`,
    ].join("\n")
  );

  const { code, stdout, stderr } = await withTimeout(
    runSshCommand(hostId, command, { sudo: true }),
    BLOCK_TIMEOUT_MS,
    "Délai dépassé lors du blocage."
  );
  if (code !== 0) throw new Error(stderr || "Échec du blocage du pare-feu.");

  if (stdout.includes("homelab_backend=ufw")) {
    return { message: `IP ${ip} bloquée via UFW (règle persistante, survit à un redémarrage).` };
  }
  if (updateMethod === "apt") {
    return { message: `IP ${ip} bloquée (règle iptables persistante, survit à un redémarrage).` };
  }
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

  const command = firewallBackendScript(
    ip,
    [`  ufw --force delete deny from "$IP" to any >/dev/null 2>&1 || true`].join("\n"),
    [
      `  iptables -D INPUT -s "$IP" -j DROP 2>/dev/null || true`,
      updateMethod === "apt"
        ? `  command -v netfilter-persistent >/dev/null 2>&1 && netfilter-persistent save >/dev/null 2>&1 || true`
        : "",
    ].join("\n")
  );

  const { code, stderr } = await withTimeout(
    runSshCommand(hostId, command, { sudo: true }),
    BLOCK_TIMEOUT_MS,
    "Délai dépassé lors du déblocage."
  );
  if (code !== 0) throw new Error(stderr || "Échec du déblocage du pare-feu.");
  return { message: `IP ${ip} débloquée.` };
}
