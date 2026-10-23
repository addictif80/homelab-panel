import { runSshCommand } from "../ssh";
import { getDb, getSetting, setSetting } from "../db";

const READ_TIMEOUT_MS = 10_000;
const WRITE_TIMEOUT_MS = 20_000;
const DEFAULT_DNS_SETTING_KEY = "default_dns_servers";

// Loose but real IPv4/IPv6 validation — this gets written straight into /etc/resolv.conf on a
// remote host, so catching an obvious typo here (before an SSH round trip) beats discovering it
// only once that host can no longer resolve anything.
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/;

function isValidIp(value: string): boolean {
  const ipv4 = IPV4_RE.exec(value);
  if (ipv4) return ipv4.slice(1).every((octet) => Number(octet) <= 255);
  return value.includes(":") && IPV6_RE.test(value);
}

/** Throws with a clear message on the first invalid entry rather than silently dropping it —
 * writing a DNS list with one bad entry quietly missing is a worse failure mode than refusing the
 * whole request up front. */
export function validateDnsServers(input: unknown): string[] {
  if (!Array.isArray(input)) throw new Error("Liste de serveurs DNS invalide.");
  const servers = input.map((s) => String(s).trim()).filter(Boolean);
  if (servers.length === 0) throw new Error("Au moins un serveur DNS est requis.");
  for (const s of servers) {
    if (!isValidIp(s)) throw new Error(`"${s}" ne ressemble pas à une adresse IP valide.`);
  }
  return servers;
}

/** Reads /etc/resolv.conf's current `nameserver` lines — the live state as it is on the host right
 * now, not anything this panel tracks itself: DHCP, NetworkManager, or a manual edit can all change
 * it outside the panel's knowledge, so this always re-reads rather than trusting a cached value. */
export async function getHostDnsServers(hostId: number): Promise<string[]> {
  const { stdout, code } = await runSshCommand(hostId, "cat /etc/resolv.conf 2>/dev/null", { timeoutMs: READ_TIMEOUT_MS });
  if (code !== 0) return [];
  return stdout
    .split("\n")
    .map((l) => /^\s*nameserver\s+(\S+)/.exec(l)?.[1])
    .filter((ip): ip is string => !!ip);
}

/**
 * Overwrites /etc/resolv.conf with exactly `servers`, replacing it outright rather than editing in
 * place — simpler and safer than patching individual `nameserver` lines, and it's what handles the
 * common case where the file is actually a symlink to systemd-resolved's own stub resolver
 * (`../run/systemd/resolve/stub-resolv.conf`): writing *through* that symlink would edit
 * systemd-resolved's generated file instead of actually taking over resolution, so the symlink is
 * removed first and a real file written in its place.
 *
 * Locks the result with `chattr +i` when the tool and filesystem support it (best-effort, never
 * fatal otherwise) — without it, the next DHCP lease renewal or systemd-resolved restart silently
 * puts the old servers straight back, which looks indistinguishable from "this never worked" from
 * the panel's side. The tradeoff is real and worth knowing, not just hidden in a comment: locking
 * it also blocks anything *else* legitimate (a VPN client pushing its own DNS, a future deliberate
 * DHCP-driven change) from taking effect until it's unlocked again — which is the point, but it
 * means a later "DNS isn't updating" report on this host should check for the lock first.
 */
export async function setHostDnsServers(hostId: number, servers: string[]): Promise<void> {
  if (servers.length === 0) throw new Error("Au moins un serveur DNS est requis.");
  const nameserverLines = servers.map((s) => `nameserver ${s}`).join("\n");
  // The heredoc delimiter is single-quoted (<<'HLP_RESOLV_EOF'), which disables all parameter/
  // command substitution inside the body — safe to interpolate the validated server list directly
  // without shell-quoting each one.
  const command = [
    `RESOLV=/etc/resolv.conf`,
    `[ -L "$RESOLV" ] && rm -f "$RESOLV"`,
    `chattr -i "$RESOLV" 2>/dev/null; true`,
    `cat > "$RESOLV" <<'HLP_RESOLV_EOF'`,
    `# Géré par Homelab Panel — une modification manuelle sera écrasée au prochain changement fait depuis le panel.`,
    nameserverLines,
    `HLP_RESOLV_EOF`,
    `chattr +i "$RESOLV" 2>/dev/null; true`,
  ].join("\n");
  const { code, stderr } = await runSshCommand(hostId, command, { sudo: true, timeoutMs: WRITE_TIMEOUT_MS });
  if (code !== 0) throw new Error(stderr.trim() || "Impossible de modifier les serveurs DNS sur cette machine.");
}

export function getDefaultDnsServers(): string[] {
  const raw = getSetting(DEFAULT_DNS_SETTING_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export type DnsApplyResult = { applied: number; failed: { host: string; error: string }[] };

/** Applies `servers` to every non-router host — routers are deliberately excluded: their DNS is
 * typically pushed to a whole LAN via DHCP through the router's own provider API (OpenWrt/pfSense/
 * Freebox, already integrated separately in this panel), not by editing a resolv.conf over SSH.
 * Sequential with a per-host try/catch (mirrors applyDefaultFailoverToAll's own bulk-apply
 * pattern) so one unreachable host doesn't abort the rest, and the caller gets back exactly which
 * ones failed and why instead of an all-or-nothing result. Also persists `servers` as the new
 * default, so the next time this form opens it's prefilled with what was actually last applied. */
export async function applyDnsServersToAllHosts(servers: string[]): Promise<DnsApplyResult> {
  setSetting(DEFAULT_DNS_SETTING_KEY, JSON.stringify(servers));

  const hosts = getDb().prepare(`SELECT id, name FROM hosts WHERE kind != 'router' ORDER BY name`).all() as {
    id: number;
    name: string;
  }[];

  let applied = 0;
  const failed: { host: string; error: string }[] = [];
  for (const host of hosts) {
    try {
      await setHostDnsServers(host.id, servers);
      applied++;
    } catch (err) {
      failed.push({ host: host.name, error: err instanceof Error ? err.message : "Erreur inconnue." });
    }
  }
  return { applied, failed };
}
