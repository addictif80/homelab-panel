import { getDb } from "./db";
import { getFleetPulse } from "./pulse";

const RECORD_INTERVAL_MS = 15_000;
const RETENTION_HOURS = 24;

async function recordTick(): Promise<void> {
  const pulses = await getFleetPulse();
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO pulse_history (host_id, reachable, latency_ms, recorded_at) VALUES (?, ?, ?, datetime('now'))`
  );
  const insertMany = db.transaction((rows: typeof pulses) => {
    for (const p of rows) {
      if (!p.configured) continue; // nothing to rewind for a host with no address on file
      insert.run(p.hostId, p.reachable ? 1 : 0, p.latencyMs);
    }
  });
  insertMany(pulses);
  db.prepare(`DELETE FROM pulse_history WHERE recorded_at < datetime('now', ?)`).run(`-${RETENTION_HOURS} hours`);
}

/**
 * Runs the whole time this process is up — a snapshot missed because the panel itself was down
 * just means a gap in the replay, which is honest (the panel can't record what it wasn't running
 * to see) rather than something to backfill or fake.
 */
export function startPulseRecorder(): void {
  recordTick().catch(() => {});
  setInterval(() => {
    recordTick().catch(() => {});
  }, RECORD_INTERVAL_MS);
}
