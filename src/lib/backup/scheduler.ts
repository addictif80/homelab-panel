import { listPlans } from "./plans";
import { getLatestRun, isRunInProgress } from "./runs";
import { runBackupPlan } from "./engine";

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 90_000;

const INTERVALS_MS: Record<string, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

async function checkDuePlans() {
  for (const plan of listPlans()) {
    if (!plan.enabled || plan.schedule === "manual") continue;
    if (isRunInProgress(plan.id)) continue;

    const interval = INTERVALS_MS[plan.schedule];
    if (!interval) continue;

    const latest = getLatestRun(plan.id);
    const since = latest ? new Date(`${latest.startedAt}Z`).getTime() : 0;
    if (Date.now() - since >= interval) {
      try {
        await runBackupPlan(plan.id);
      } catch {
        // The run itself records its own failure in backup_runs; nothing more to do here.
      }
    }
  }
}

let started = false;

/** Checks every 15 minutes whether any enabled plan is due, per its own hourly/daily/weekly
 * cadence measured from its last run — not a wall-clock cron schedule, which keeps this simple
 * and robust without needing exact-time precision for backup cadence. */
export function startBackupScheduler() {
  if (started) return;
  started = true;
  setTimeout(checkDuePlans, FIRST_RUN_DELAY_MS);
  setInterval(checkDuePlans, CHECK_INTERVAL_MS);
}
