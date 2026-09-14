import { refreshLicenseIfSubscription } from "./license";

const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60_000;

let started = false;

/** Keeps a subscription instance's cached certificate current — a no-op for lifetime/trial/seller
 * instances (see refreshLicenseIfSubscription), so this is safe to always run. */
export function startLicenseRenewalScheduler(): void {
  if (started) return;
  started = true;
  const tick = () => refreshLicenseIfSubscription().catch(() => {});
  setTimeout(tick, FIRST_RUN_DELAY_MS);
  setInterval(tick, REFRESH_INTERVAL_MS);
}
