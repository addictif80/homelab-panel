import { pollAllMailLogSources } from "./mailIngest";

const POLL_INTERVAL_MS = 2 * 60_000;
const FIRST_RUN_DELAY_MS = 20_000;

let started = false;

/** Periodically pulls new lines from every configured mail log source and stores any recognized
 * mail events — same fire-and-forget shape as the other background schedulers in server.ts. */
export function startMailScheduler(): void {
  if (started) return;
  started = true;
  const tick = () => pollAllMailLogSources().catch(() => {});
  setTimeout(tick, FIRST_RUN_DELAY_MS);
  setInterval(tick, POLL_INTERVAL_MS);
}
