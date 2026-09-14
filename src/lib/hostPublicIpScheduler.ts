import { detectAllHostPublicIps } from "./hostPublicIp";

const REFRESH_INTERVAL_MS = 30 * 60_000;
const FIRST_RUN_DELAY_MS = 30_000;

let started = false;

/** Keeps every SSH-reachable host's public_ip current in the background — the same 30min cadence
 * as the panel's own egress-IP cache, so the sidebar's public IP list reflects real infrastructure
 * addresses without anyone needing to type them in or click a button. */
export function startHostPublicIpScheduler(): void {
  if (started) return;
  started = true;
  const tick = () => detectAllHostPublicIps().catch(() => {});
  setTimeout(tick, FIRST_RUN_DELAY_MS);
  setInterval(tick, REFRESH_INTERVAL_MS);
}
