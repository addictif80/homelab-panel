import { getDb } from "../db";
import { DEMO_CONTAINERS } from "./seedDemo";

type ExecResult = { stdout: string; stderr: string; code: number };

/** Deterministic-ish but slightly varying fake fleet stats per host, so the dashboard doesn't look
 * frozen/fake on repeat visits within the same session — seeded off the host id so each machine
 * keeps a stable "personality" (e.g. the NAS always reads busier than a fresh VPS). */
function fakeStats(hostId: number): { cores: number; memTotalKb: number; memAvailKb: number; diskTotalKb: number; diskUsedKb: number; idlePercent: number } {
  const wobble = (Date.now() / 60_000 + hostId) % 10; // slow drift, changes every ~6s of wall time
  const cores = [4, 8, 4, 2, 2, 1][hostId % 6] ?? 4;
  const memTotalKb = cores * 4_000_000;
  const usedFraction = 0.3 + hostId * 0.07 + wobble * 0.01;
  const memAvailKb = Math.round(memTotalKb * (1 - Math.min(usedFraction, 0.85)));
  const diskTotalKb = 500_000_000 + hostId * 120_000_000;
  const diskUsedKb = Math.round(diskTotalKb * (0.25 + hostId * 0.08));
  const idlePercent = Math.max(5, 90 - hostId * 8 - wobble);
  return { cores, memTotalKb, memAvailKb, diskTotalKb, diskUsedKb, idlePercent };
}

function hostSlug(hostId: number): string | null {
  const row = getDb().prepare(`SELECT slug FROM hosts WHERE id = ?`).get(hostId) as { slug: string } | undefined;
  return row?.slug ?? null;
}

function dockerPsJson(hostId: number): string {
  const slug = hostSlug(hostId);
  const containers = (slug && DEMO_CONTAINERS[slug]) || [];
  return containers
    .map((c) =>
      JSON.stringify({
        ID: c.id,
        Names: c.name,
        Image: c.image,
        Status: c.status,
        State: c.state,
        Ports: c.ports,
        CreatedAt: "2025-01-01 00:00:00 +0000 UTC",
      })
    )
    .join("\n");
}

function monitoringStats(hostId: number): string {
  const s = fakeStats(hostId);
  return [
    `CORES:${s.cores}`,
    `MEMTOTAL:${s.memTotalKb}`,
    `MEMAVAIL:${s.memAvailKb}`,
    `DISK:${s.diskTotalKb} ${s.diskUsedKb}`,
    `CPULINE:%Cpu(s):  ${(100 - s.idlePercent).toFixed(1)} us,  0.0 sy,  0.0 ni, ${s.idlePercent.toFixed(1)} id`,
  ].join("\n");
}

/**
 * Every SSH command the app would otherwise run against a real host, faked. Only the handful of
 * commands that drive the flagship demo pages (dashboard stats, Docker) get realistic tailored
 * output; anything else (hardware sensors, backup file listing, discovery scans...) returns a
 * harmless empty success instead of erroring, so a page that isn't specifically simulated still
 * renders its normal empty state rather than crashing.
 */
export function fakeExec(hostId: number, rawCommand: string): ExecResult {
  if (rawCommand.includes("docker ps -a --format")) {
    const markerMatch = rawCommand.match(/^echo (\S+);/);
    const marker = markerMatch ? markerMatch[1] : "";
    return { stdout: marker ? `${marker}\n${dockerPsJson(hostId)}` : dockerPsJson(hostId), stderr: "", code: 0 };
  }

  if (rawCommand.includes("CORES:$(nproc)")) {
    return { stdout: monitoringStats(hostId), stderr: "", code: 0 };
  }

  return { stdout: "", stderr: "", code: 0 };
}
