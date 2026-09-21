import { getDb } from "../db";
import { isInternetReachable } from "./probe";

const CHECK_INTERVAL_MS = 60_000;

async function tick(): Promise<void> {
  const reachable = await isInternetReachable();
  const db = getDb();
  const openOutage = db
    .prepare(`SELECT id FROM isp_outages WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1`)
    .get() as { id: number } | undefined;

  if (!reachable && !openOutage) {
    db.prepare(`INSERT INTO isp_outages (started_at) VALUES (datetime('now'))`).run();
  } else if (reachable && openOutage) {
    db.prepare(`UPDATE isp_outages SET ended_at = datetime('now') WHERE id = ?`).run(openOutage.id);
  }
}

/** Runs the whole time this process is up. A crash/restart of the panel mid-outage would leave a
 * row with no ended_at forever — harmless (the report below treats an unclosed row as "still
 * ongoing as of the last check", never as a fabricated end time), and the next connectivity check
 * on restart closes it the moment the line comes back. */
export function startIspOutageRecorder(): void {
  tick().catch(() => {});
  setInterval(() => {
    tick().catch(() => {});
  }, CHECK_INTERVAL_MS);
}
