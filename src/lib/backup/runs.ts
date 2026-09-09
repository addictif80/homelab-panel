import { randomUUID } from "crypto";
import { getDb } from "../db";

export type BackupRunStatus = "running" | "success" | "failed";

export type BackupRun = {
  id: string;
  planId: string;
  status: BackupRunStatus;
  log: string;
  snapshotPath: string | null;
  paths: string[];
  startedAt: string;
  finishedAt: string | null;
};

type RunRow = {
  id: string;
  plan_id: string;
  status: BackupRunStatus;
  log: string;
  snapshot_path: string | null;
  paths_json: string | null;
  started_at: string;
  finished_at: string | null;
};

function rowToRun(row: RunRow): BackupRun {
  return {
    id: row.id,
    planId: row.plan_id,
    status: row.status,
    log: row.log,
    snapshotPath: row.snapshot_path,
    paths: row.paths_json ? JSON.parse(row.paths_json) : [],
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function startRun(planId: string): string {
  const runId = randomUUID();
  getDb()
    .prepare(`INSERT INTO backup_runs (id, plan_id, status, log) VALUES (?, ?, 'running', '')`)
    .run(runId, planId);
  return runId;
}

export function appendRunLog(runId: string, text: string): void {
  if (!text) return;
  getDb().prepare(`UPDATE backup_runs SET log = log || ? WHERE id = ?`).run(text, runId);
}

export function finishRun(
  runId: string,
  status: "success" | "failed",
  snapshotPath: string | null,
  paths: string[] = []
): void {
  getDb()
    .prepare(
      `UPDATE backup_runs SET status = ?, snapshot_path = ?, paths_json = ?, finished_at = datetime('now') WHERE id = ?`
    )
    .run(status, snapshotPath, JSON.stringify(paths), runId);
}

export function getRun(runId: string): BackupRun | null {
  const row = getDb().prepare(`SELECT * FROM backup_runs WHERE id = ?`).get(runId) as RunRow | undefined;
  return row ? rowToRun(row) : null;
}

export function listRuns(planId: string, limit = 20): BackupRun[] {
  return (
    getDb()
      .prepare(`SELECT * FROM backup_runs WHERE plan_id = ? ORDER BY started_at DESC LIMIT ?`)
      .all(planId, limit) as RunRow[]
  ).map(rowToRun);
}

export function getLatestRun(planId: string): BackupRun | null {
  const row = getDb()
    .prepare(`SELECT * FROM backup_runs WHERE plan_id = ? ORDER BY started_at DESC LIMIT 1`)
    .get(planId) as RunRow | undefined;
  return row ? rowToRun(row) : null;
}

export function isRunInProgress(planId: string): boolean {
  const row = getDb()
    .prepare(`SELECT 1 FROM backup_runs WHERE plan_id = ? AND status = 'running' LIMIT 1`)
    .get(planId);
  return !!row;
}
