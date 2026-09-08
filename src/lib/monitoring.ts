import { getDb } from "./db";
import { runSshCommand } from "./ssh";

export type HostStats = {
  hostId: number;
  hostName: string;
  cores: number | null;
  cpuUsedPercent: number | null;
  memTotalMb: number | null;
  memUsedMb: number | null;
  diskTotalGb: number | null;
  diskUsedGb: number | null;
  error: string | null;
};

// Plain-text markers, one per line, so parsing in TS stays simple and doesn't need
// shell-side JSON assembly (which would mean juggling nested quotes over SSH).
const STATS_COMMAND = [
  'echo "CORES:$(nproc)"',
  'echo "MEMTOTAL:$(awk \'/MemTotal/{print $2}\' /proc/meminfo)"',
  'echo "MEMAVAIL:$(awk \'/MemAvailable/{print $2}\' /proc/meminfo)"',
  'echo "DISK:$(df -kP / | tail -1 | awk \'{print $2, $3}\')"',
  'echo "CPULINE:$(top -bn1 | grep -i \'Cpu(s)\')"',
].join("; ");

function parseStats(stdout: string): Omit<HostStats, "hostId" | "hostName" | "error"> {
  const values: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    values[line.slice(0, idx)] = line.slice(idx + 1).trim();
  }

  const cores = values.CORES ? parseInt(values.CORES, 10) : null;
  const memTotalKb = values.MEMTOTAL ? parseInt(values.MEMTOTAL, 10) : null;
  const memAvailKb = values.MEMAVAIL ? parseInt(values.MEMAVAIL, 10) : null;
  const memUsedMb = memTotalKb !== null && memAvailKb !== null ? (memTotalKb - memAvailKb) / 1024 : null;
  const memTotalMb = memTotalKb !== null ? memTotalKb / 1024 : null;

  const [diskTotalKbStr, diskUsedKbStr] = (values.DISK ?? "").split(/\s+/);
  const diskTotalGb = diskTotalKbStr ? parseInt(diskTotalKbStr, 10) / 1024 / 1024 : null;
  const diskUsedGb = diskUsedKbStr ? parseInt(diskUsedKbStr, 10) / 1024 / 1024 : null;

  const idleMatch = (values.CPULINE ?? "").match(/([\d.]+)\s*id/);
  const cpuUsedPercent = idleMatch ? Math.max(0, 100 - parseFloat(idleMatch[1])) : null;

  return { cores, cpuUsedPercent, memTotalMb, memUsedMb, diskTotalGb, diskUsedGb };
}

export async function getHostStats(hostId: number, hostName: string): Promise<HostStats> {
  try {
    const { stdout, code } = await runSshCommand(hostId, STATS_COMMAND, { sudo: false });
    if (code !== 0) throw new Error("Impossible de lire les statistiques.");
    return { hostId, hostName, ...parseStats(stdout), error: null };
  } catch (err) {
    return {
      hostId,
      hostName,
      cores: null,
      cpuUsedPercent: null,
      memTotalMb: null,
      memUsedMb: null,
      diskTotalGb: null,
      diskUsedGb: null,
      error: err instanceof Error ? err.message : "Erreur inconnue.",
    };
  }
}

/** Stats for every physical server + VPS — the machines "you SSH into", as opposed to Proxmox guests. */
export async function getFleetStats(): Promise<HostStats[]> {
  const hosts = getDb()
    .prepare(`SELECT id, name FROM hosts WHERE kind IN ('physical','vps') ORDER BY name`)
    .all() as { id: number; name: string }[];

  return Promise.all(hosts.map((h) => getHostStats(h.id, h.name)));
}
