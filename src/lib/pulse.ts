import net from "net";
import { getDb } from "./db";
import { resolveHostAddress } from "./ssh";

export type HostPulse = {
  hostId: number;
  reachable: boolean;
  latencyMs: number | null;
  /** False when the host has no IP on file at all — distinct from a real probe timeout, so the
   * UI can show "not configured yet" (neutral) instead of implying the machine is down. */
  configured: boolean;
};

const PROBE_TIMEOUT_MS = 800;

/**
 * Fast, cheap "is anything home" check — a raw TCP connect attempt, not a full SSH/API login.
 * A connection refused (port closed) still means the host itself answered, so it counts as
 * reachable; only a timeout (nothing on the other end at all) counts as down. This lets one
 * uniform probe work across every host kind (SSH server, router web UI, NAS, ...) without needing
 * to know which service each one actually runs.
 */
function probeHost(address: string, port: number): Promise<{ reachable: boolean; latencyMs: number | null }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let settled = false;
    const finish = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ reachable, latencyMs: reachable ? Date.now() - start : null });
    };
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once("connect", () => finish(true));
    socket.once("error", (err: NodeJS.ErrnoException) => finish(err.code === "ECONNREFUSED"));
    socket.once("timeout", () => finish(false));
    socket.connect(port, address);
  });
}

type HostRow = {
  id: number;
  lan_ip: string | null;
  tailscale_ip: string | null;
  public_ip: string | null;
  ssh_port: number;
  ssh_user: string | null;
};

export type PulseHistoryRow = { hostId: number; reachable: boolean; latencyMs: number | null; recordedAt: string };

/** Raw recorded ticks for the "boîte noire" rewind — grouping by exact recorded_at into distinct
 * ticks is left to the caller, since a single recording pass writes all hosts within the same
 * SQLite-resolution second and is cheap to re-group in JS. */
export function getPulseHistory(sinceHoursAgo: number): PulseHistoryRow[] {
  return getDb()
    .prepare(
      `SELECT host_id as hostId, reachable, latency_ms as latencyMs, recorded_at as recordedAt
       FROM pulse_history
       WHERE recorded_at > datetime('now', ?)
       ORDER BY recorded_at ASC`
    )
    .all(`-${sinceHoursAgo} hours`)
    .map((r) => {
      const row = r as { hostId: number; reachable: number; latencyMs: number | null; recordedAt: string };
      return { ...row, reachable: !!row.reachable };
    });
}

export async function getFleetPulse(): Promise<HostPulse[]> {
  const hosts = getDb()
    .prepare(`SELECT id, lan_ip, tailscale_ip, public_ip, ssh_port, ssh_user FROM hosts`)
    .all() as HostRow[];

  return Promise.all(
    hosts.map(async (host) => {
      const address = resolveHostAddress(host);
      if (!address) return { hostId: host.id, reachable: false, latencyMs: null, configured: false };
      const { reachable, latencyMs } = await probeHost(address, host.ssh_port || 22);
      return { hostId: host.id, reachable, latencyMs, configured: true };
    })
  );
}
