import { randomUUID } from "crypto";
import { getDb } from "./db";

/**
 * Generic tracker for any long-running background action (IP/sender blocking fan-out, Docker
 * stack redeploy, DB dump/restore...) — the same insert-running / append-log / finish shape
 * update_jobs, migration_jobs, copy_jobs, backup_runs and restore_drills each already hand-roll
 * separately, extracted once here for every *new* action instead of adding a 7th copy. See the
 * table's own comment in db.ts for why this exists as a distinct generic table rather than
 * migrating those older ones onto it (churn/risk not worth it for something already working).
 */

export type JobStatus = "running" | "success" | "failed";

export type BackgroundJob = {
  id: string;
  kind: string;
  label: string;
  hostId: number | null;
  status: JobStatus;
  log: string;
  result: unknown;
  startedAt: string;
  finishedAt: string | null;
};

type JobRow = {
  id: string;
  kind: string;
  label: string;
  host_id: number | null;
  status: JobStatus;
  log: string;
  result_json: string | null;
  started_at: string;
  finished_at: string | null;
};

function rowToJob(row: JobRow): BackgroundJob {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    hostId: row.host_id,
    status: row.status,
    log: row.log,
    result: row.result_json ? JSON.parse(row.result_json) : null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

/** Creates the row and returns its id — call this synchronously before kicking off the actual
 * (unawaited) async work, so the id is available to return to the client immediately. */
export function startJob(kind: string, label: string, hostId?: number): string {
  const id = randomUUID();
  getDb()
    .prepare(`INSERT INTO background_jobs (id, kind, label, host_id, status, log) VALUES (?, ?, ?, ?, 'running', '')`)
    .run(id, kind, label, hostId ?? null);
  return id;
}

export function appendJobLog(id: string, text: string): void {
  getDb().prepare(`UPDATE background_jobs SET log = log || ? WHERE id = ?`).run(text, id);
}

export function finishJob(id: string, status: "success" | "failed", result?: unknown): void {
  getDb()
    .prepare(`UPDATE background_jobs SET status = ?, result_json = ?, finished_at = datetime('now') WHERE id = ?`)
    .run(status, result !== undefined ? JSON.stringify(result) : null, id);
}

export function getJob(id: string): BackgroundJob | null {
  const row = getDb().prepare(`SELECT * FROM background_jobs WHERE id = ?`).get(id) as JobRow | undefined;
  return row ? rowToJob(row) : null;
}

/**
 * Most recent job of this kind (optionally scoped to a host) — the actual fix for "looks like
 * nothing happened after I reopened the panel": a page calls this on mount instead of only ever
 * knowing about a job id it just started itself, so a still-running (or just-finished) action
 * shows up again even from a different device or after the tab was closed.
 */
export function getLatestJob(kind: string, hostId?: number): BackgroundJob | null {
  const row = (
    hostId !== undefined
      ? getDb()
          .prepare(`SELECT * FROM background_jobs WHERE kind = ? AND host_id = ? ORDER BY started_at DESC LIMIT 1`)
          .get(kind, hostId)
      : getDb().prepare(`SELECT * FROM background_jobs WHERE kind = ? ORDER BY started_at DESC LIMIT 1`).get(kind)
  ) as JobRow | undefined;
  return row ? rowToJob(row) : null;
}

/** Every currently-running job, regardless of kind — powers a small global indicator so a heavy
 * action started elsewhere (another device, a closed tab) is still visible from any page. */
export function listRunningJobs(): BackgroundJob[] {
  return (
    getDb().prepare(`SELECT * FROM background_jobs WHERE status = 'running' ORDER BY started_at DESC`).all() as JobRow[]
  ).map(rowToJob);
}

/** Recent jobs of any kind/status, most recent first — for a general "activité récente" list. */
export function listRecentJobs(limit = 50): BackgroundJob[] {
  return (
    getDb().prepare(`SELECT * FROM background_jobs ORDER BY started_at DESC LIMIT ?`).all(limit) as JobRow[]
  ).map(rowToJob);
}
