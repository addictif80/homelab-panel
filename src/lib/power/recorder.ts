import { getDb } from "../db";
import { getFleetStats } from "../monitoring";

// CPU load is read over SSH (see lib/monitoring.ts) — sampling it as often as pulse_history's
// pings (every 15s) would mean an SSH round trip to every host that often just to feed a cost
// estimate, which doesn't need that resolution: 15 minutes is plenty to average a bill over.
const SAMPLE_INTERVAL_MS = 15 * 60 * 1000;
export const POWER_RETENTION_DAYS = 35;

async function sampleTick(): Promise<void> {
  const stats = await getFleetStats();
  const db = getDb();
  const insert = db.prepare(`INSERT INTO power_samples (host_id, cpu_percent, recorded_at) VALUES (?, ?, datetime('now'))`);
  const insertMany = db.transaction((rows: typeof stats) => {
    for (const s of rows) {
      if (s.error || s.cpuUsedPercent === null) continue; // an unreachable host isn't drawing "0 W" — just unknown, don't fake a zero sample
      insert.run(s.hostId, s.cpuUsedPercent);
    }
  });
  insertMany(stats);
  db.prepare(`DELETE FROM power_samples WHERE recorded_at < datetime('now', ?)`).run(`-${POWER_RETENTION_DAYS} days`);
}

/** Runs the whole time this process is up — like pulseRecorder, a gap while the panel was down is
 * an honest gap in the average, not something to backfill or fake. */
export function startPowerRecorder(): void {
  sampleTick().catch(() => {});
  setInterval(() => {
    sampleTick().catch(() => {});
  }, SAMPLE_INTERVAL_MS);
}
