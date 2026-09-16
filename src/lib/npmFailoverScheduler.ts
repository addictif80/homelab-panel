import { checkAllFailovers } from "./npmFailover";

const CHECK_INTERVAL_MS = 60_000;
const FIRST_RUN_DELAY_MS = 15_000;

let started = false;

/** Periodically probes each configured failover pair's primary/backup reachability for display —
 * the actual failover itself is nginx-native (see npmFailover.ts), this just keeps the UI's
 * status badge current. */
export function startNpmFailoverScheduler(): void {
  if (started) return;
  started = true;
  const tick = () => checkAllFailovers().catch(() => {});
  setTimeout(tick, FIRST_RUN_DELAY_MS);
  setInterval(tick, CHECK_INTERVAL_MS);
}
