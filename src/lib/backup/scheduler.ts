import { listPlans } from "./plans";
import { getLatestRun, isRunInProgress } from "./runs";
import { runBackupPlan } from "./engine";
import { isLockdownActive } from "../lockdown";

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 90_000;

const INTERVALS_MS: Record<string, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

function parseAtTime(atTime: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(atTime.trim());
  if (!m) return null;
  const hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/** True once the server's local clock has passed today's occurrence of `atTime` — malformed input
 * degrades to "always past due" so a bad value can't silently block a plan from ever running
 * again (it just falls back to the plain elapsed-time behavior below). */
function isPastScheduledTimeToday(atTime: string): boolean {
  const parsed = parseAtTime(atTime);
  if (!parsed) return true;
  const now = new Date();
  const scheduled = new Date(now);
  scheduled.setHours(parsed.hour, parsed.minute, 0, 0);
  return now.getTime() >= scheduled.getTime();
}

async function checkDuePlans() {
  if (isLockdownActive()) return;
  for (const plan of listPlans()) {
    if (!plan.enabled || plan.schedule === "manual") continue;
    if (isRunInProgress(plan.id)) continue;

    const interval = INTERVALS_MS[plan.schedule];
    if (!interval) continue;

    const latest = getLatestRun(plan.id);
    const since = latest ? new Date(`${latest.startedAt}Z`).getTime() : 0;
    const elapsedMs = Date.now() - since;

    let due: boolean;
    if (plan.atTime && (plan.schedule === "daily" || plan.schedule === "weekly")) {
      // Wall-clock mode: still gated by the plan's own cadence (a weekly plan stays weekly) but
      // only fires once the scheduled time of day has passed. The elapsed-time gate is relaxed to
      // a bit under the full interval — this only runs on a 15-min poll, not exactly on the
      // minute, so requiring the *entire* interval to have elapsed could let one check cycle slip
      // past the scheduled time and push the run to the next poll a day/week later instead.
      const minGap = interval - CHECK_INTERVAL_MS * 2;
      due = elapsedMs >= minGap && isPastScheduledTimeToday(plan.atTime);
    } else {
      due = elapsedMs >= interval;
    }

    if (due) {
      try {
        await runBackupPlan(plan.id);
      } catch {
        // The run itself records its own failure in backup_runs; nothing more to do here.
      }
    }
  }
}

let started = false;

/** Checks every 15 minutes whether any enabled plan is due. Without a fixed time of day
 * (`atTime`), a plan's own hourly/daily/weekly cadence is measured purely from its last run — not
 * a wall-clock cron schedule. With `atTime` set (daily/weekly only), it additionally waits for
 * that time of day to pass before firing, so e.g. "always at 3am" is possible without needing
 * exact-to-the-minute precision. */
export function startBackupScheduler() {
  if (started) return;
  started = true;
  setTimeout(checkDuePlans, FIRST_RUN_DELAY_MS);
  setInterval(checkDuePlans, CHECK_INTERVAL_MS);
}
