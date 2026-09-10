import { getDb } from "./db";
import { runSshCommand } from "./ssh";

export type DiscoveredDevice = { ip: string; mac: string | null };

function subnetBase(ip: string): string | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

/**
 * Populates the scanning host's own ARP cache by pinging every address on its /24 in parallel
 * (fire-and-forget, backgrounded), then reads back whatever answered — cheap and needs no extra
 * tooling (nmap/arp-scan) beyond what's on every Linux box already.
 */
function buildScanCommand(base: string): string {
  return (
    `for i in $(seq 1 254); do (ping -c1 -W1 ${base}.$i > /dev/null 2>&1 &) ; done; sleep 4; ` +
    `(ip neigh show 2>/dev/null || arp -an 2>/dev/null)`
  );
}

function parseNeighbors(output: string): DiscoveredDevice[] {
  const devices = new Map<string, string | null>();

  // `ip neigh show` lines: "192.168.1.10 dev eth0 lladdr aa:bb:cc:dd:ee:ff REACHABLE"
  for (const line of output.split("\n")) {
    const ipNeigh = line.match(/^(\d+\.\d+\.\d+\.\d+)\s.*lladdr\s+([0-9a-fA-F:]+)/);
    if (ipNeigh) {
      devices.set(ipNeigh[1], ipNeigh[2]);
      continue;
    }
    // `arp -an` lines: "? (192.168.1.10) at aa:bb:cc:dd:ee:ff [ether] on eth0"
    const arpAn = line.match(/\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-fA-F:]+)/);
    if (arpAn) devices.set(arpAn[1], arpAn[2]);
  }

  return [...devices.entries()].map(([ip, mac]) => ({ ip, mac }));
}

export async function scanLan(hostId: number): Promise<DiscoveredDevice[]> {
  const host = getDb().prepare(`SELECT lan_ip FROM hosts WHERE id = ?`).get(hostId) as
    | { lan_ip: string | null }
    | undefined;
  if (!host?.lan_ip) throw new Error("Cette machine n'a pas d'IP LAN renseignée dans l'inventaire.");

  const base = subnetBase(host.lan_ip);
  if (!base) throw new Error("IP LAN invalide pour cette machine.");

  const result = await runSshCommand(hostId, buildScanCommand(base));
  return parseNeighbors(result.stdout);
}

export type KnownHostSummary = { id: number; name: string; lan_ip: string | null };

export function listKnownLanIps(): KnownHostSummary[] {
  return getDb()
    .prepare(`SELECT id, name, lan_ip FROM hosts WHERE lan_ip IS NOT NULL`)
    .all() as KnownHostSummary[];
}
