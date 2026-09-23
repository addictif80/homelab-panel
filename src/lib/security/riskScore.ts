import { getDb } from "../db";
import { scanAllHosts } from "./scan";
import type { Severity } from "./types";

// Deliberately coarse, not a precise CVSS-style model — the point of a single number is to answer
// "worse or better than last month", not to stand up to security-audit scrutiny. Weights are
// capped per category below so one noisy host with 20 "info" findings can't swamp the score the
// way one real critical finding should.
const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 15, warning: 5, info: 1, good: 0 };
const MAX_FINDING_PENALTY = 70;
const BACKUP_STALE_PENALTY = 10;
const MAX_BACKUP_PENALTY = 30;

type BackupPlanRow = { id: string; name: string; schedule: "manual" | "hourly" | "daily" | "weekly"; enabled: number };
type LastRunRow = { status: string; started_at: string };

const SCHEDULE_HOURS: Record<string, number> = { hourly: 1, daily: 24, weekly: 24 * 7 };

/** A plan is "stale" once it's gone more than 2x its own schedule interval without a successful
 * run — long enough to not flag a plan that's merely a few minutes late, short enough to catch a
 * silently-broken schedule before it's been broken for weeks. Manual plans are never penalized
 * this way (there's no expected cadence to be late against). */
function isBackupPlanStale(plan: BackupPlanRow): boolean {
  if (plan.schedule === "manual" || !plan.enabled) return false;
  const lastSuccess = getDb()
    .prepare(`SELECT status, started_at FROM backup_runs WHERE plan_id = ? AND status = 'success' ORDER BY started_at DESC LIMIT 1`)
    .get(plan.id) as LastRunRow | undefined;
  if (!lastSuccess) return true;
  const ageHours = (Date.now() - new Date(`${lastSuccess.started_at}Z`).getTime()) / 3_600_000;
  return ageHours > SCHEDULE_HOURS[plan.schedule] * 2;
}

export type RiskScoreBreakdown = {
  score: number;
  findingPenalty: number;
  backupPenalty: number;
  criticalCount: number;
  warningCount: number;
  staleBackupPlans: string[];
};

/** Computes today's score fresh (runs a full security scan — the same one the Security Center
 * page triggers — plus a backup-freshness check) rather than reading anything cached, since a
 * "risk score" that lags behind the findings it's supposed to summarize is worse than none. */
export async function computeRiskScore(): Promise<RiskScoreBreakdown> {
  const results = await scanAllHosts();
  const findings = results.flatMap((r) => r.findings).filter((f) => !f.ignored);
  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;
  const findingPenalty = Math.min(
    MAX_FINDING_PENALTY,
    findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0)
  );

  const plans = getDb().prepare(`SELECT id, name, schedule, enabled FROM backup_plans`).all() as BackupPlanRow[];
  const stalePlans = plans.filter(isBackupPlanStale);
  const backupPenalty = Math.min(MAX_BACKUP_PENALTY, stalePlans.length * BACKUP_STALE_PENALTY);

  const score = Math.max(0, 100 - findingPenalty - backupPenalty);
  return {
    score,
    findingPenalty,
    backupPenalty,
    criticalCount,
    warningCount,
    staleBackupPlans: stalePlans.map((p) => p.name),
  };
}

/** Recomputes and upserts today's snapshot — called by the daily scheduler and by a manual
 * "recalculer" action, both hitting the same row for today rather than accumulating duplicates. */
export async function refreshRiskScoreHistory(): Promise<RiskScoreBreakdown> {
  const breakdown = await computeRiskScore();
  const today = new Date().toISOString().slice(0, 10);
  getDb()
    .prepare(
      `INSERT INTO risk_score_history (date, score, computed_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(date) DO UPDATE SET score = excluded.score, computed_at = excluded.computed_at`
    )
    .run(today, breakdown.score);
  return breakdown;
}

export type RiskScorePoint = { date: string; score: number };

export function getRiskScoreHistory(days = 30): RiskScorePoint[] {
  return getDb()
    .prepare(`SELECT date, score FROM risk_score_history ORDER BY date DESC LIMIT ?`)
    .all(days)
    .reverse() as RiskScorePoint[];
}

const DAY_MS = 24 * 60 * 60_000;
let started = false;

/** Once a day is plenty for a trend line meant to answer "worse or better than last month" — see
 * server.ts for where this joins the other fire-and-forget schedulers. First run is delayed so it
 * doesn't compete with everything else initializing right at boot. */
export function startRiskScoreScheduler(): void {
  if (started) return;
  started = true;
  const tick = () => refreshRiskScoreHistory().catch(() => {});
  setTimeout(tick, 60_000);
  setInterval(tick, DAY_MS);
}
