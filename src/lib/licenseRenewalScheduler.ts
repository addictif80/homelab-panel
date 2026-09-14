import { refreshLicenseIfSubscription, syncTrialStart } from "./license";

const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60_000;

let started = false;

/** Keeps a subscription instance's cached certificate current, and reports this machine's trial
 * fingerprint to the seller server — both are no-ops in the wrong state (see their own doc
 * comments in license.ts), so it's safe to always run both on every tick. */
export function startLicenseRenewalScheduler(): void {
  if (started) return;
  started = true;
  const tick = () => {
    refreshLicenseIfSubscription().catch(() => {});
    syncTrialStart().catch(() => {});
  };
  setTimeout(tick, FIRST_RUN_DELAY_MS);
  setInterval(tick, REFRESH_INTERVAL_MS);
}
