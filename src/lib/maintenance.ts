import { randomUUID } from "crypto";
import { getDb } from "./db";
import { buildUpdateCommand, startUpdateJob, type UpdateMethod, type UpdateMode } from "./updates";

export type MaintenancePlan = {
  id: string;
  name: string;
  hostIds: number[];
  mode: UpdateMode;
  allowAutoReboot: boolean;
  delaySeconds: number;
  createdAt: string;
};

type PlanRow = {
  id: string;
  name: string;
  host_ids_json: string;
  mode: UpdateMode;
  allow_auto_reboot: number;
  delay_seconds: number;
  created_at: string;
};

function rowToPlan(row: PlanRow): MaintenancePlan {
  return {
    id: row.id,
    name: row.name,
    hostIds: JSON.parse(row.host_ids_json),
    mode: row.mode,
    allowAutoReboot: !!row.allow_auto_reboot,
    delaySeconds: row.delay_seconds,
    createdAt: row.created_at,
  };
}

export function listPlans(): MaintenancePlan[] {
  return (getDb().prepare(`SELECT * FROM maintenance_plans ORDER BY created_at DESC`).all() as PlanRow[]).map(
    rowToPlan
  );
}

export function getPlan(id: string): MaintenancePlan | null {
  const row = getDb().prepare(`SELECT * FROM maintenance_plans WHERE id = ?`).get(id) as PlanRow | undefined;
  return row ? rowToPlan(row) : null;
}

export function createPlan(input: {
  name: string;
  hostIds: number[];
  mode: UpdateMode;
  allowAutoReboot: boolean;
  delaySeconds: number;
}): MaintenancePlan {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO maintenance_plans (id, name, host_ids_json, mode, allow_auto_reboot, delay_seconds)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.name,
      JSON.stringify(input.hostIds),
      input.mode,
      input.allowAutoReboot ? 1 : 0,
      input.delaySeconds
    );
  return getPlan(id)!;
}

export function deletePlan(id: string): void {
  getDb().prepare(`DELETE FROM maintenance_plans WHERE id = ?`).run(id);
}

export type MaintenanceRun = {
  id: string;
  planId: string;
  status: "running" | "success" | "failed";
  currentIndex: number;
  jobIds: string[];
  startedAt: string;
  finishedAt: string | null;
};

type RunRow = {
  id: string;
  plan_id: string;
  status: "running" | "success" | "failed";
  current_index: number;
  job_ids_json: string;
  started_at: string;
  finished_at: string | null;
};

function rowToRun(row: RunRow): MaintenanceRun {
  return {
    id: row.id,
    planId: row.plan_id,
    status: row.status,
    currentIndex: row.current_index,
    jobIds: JSON.parse(row.job_ids_json),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function getRun(id: string): MaintenanceRun | null {
  const row = getDb().prepare(`SELECT * FROM maintenance_runs WHERE id = ?`).get(id) as RunRow | undefined;
  return row ? rowToRun(row) : null;
}

export function getLatestRunForPlan(planId: string): MaintenanceRun | null {
  const row = getDb()
    .prepare(`SELECT * FROM maintenance_runs WHERE plan_id = ? ORDER BY started_at DESC LIMIT 1`)
    .get(planId) as RunRow | undefined;
  return row ? rowToRun(row) : null;
}

function appendRunJob(runId: string, jobId: string, nextIndex: number) {
  const run = getRun(runId);
  if (!run) return;
  const jobIds = [...run.jobIds, jobId];
  getDb()
    .prepare(`UPDATE maintenance_runs SET job_ids_json = ?, current_index = ? WHERE id = ?`)
    .run(JSON.stringify(jobIds), nextIndex, runId);
}

function finishRun(runId: string, status: "success" | "failed") {
  getDb()
    .prepare(`UPDATE maintenance_runs SET status = ?, finished_at = datetime('now') WHERE id = ?`)
    .run(status, runId);
}

/**
 * Runs each host's update job to completion, one at a time in the plan's order, waiting
 * `delaySeconds` between hosts — lets a router or NAS finish rebooting before the next host
 * (which might depend on it for DNS/routing) gets touched. Runs entirely server-side, independent
 * of any browser connection, the same way a single startUpdateJob does.
 */
export function runPlan(planId: string): string {
  const plan = getPlan(planId);
  if (!plan) throw new Error("Plan de maintenance introuvable.");
  if (plan.hostIds.length === 0) throw new Error("Ce plan ne contient aucune machine.");

  const runId = randomUUID();
  getDb()
    .prepare(`INSERT INTO maintenance_runs (id, plan_id, status, current_index, job_ids_json) VALUES (?, ?, 'running', 0, '[]')`)
    .run(runId, planId);

  runStep(runId, plan, 0);
  return runId;
}

function runStep(runId: string, plan: MaintenancePlan, index: number) {
  if (index >= plan.hostIds.length) {
    finishRun(runId, "success");
    return;
  }

  const hostId = plan.hostIds[index];
  const host = getDb().prepare(`SELECT update_method FROM hosts WHERE id = ?`).get(hostId) as
    | { update_method: UpdateMethod | null }
    | undefined;

  if (!host || !host.update_method) {
    // No update method on file for this host — skip it rather than fail the whole window.
    appendRunJob(runId, "", index + 1);
    runStep(runId, plan, index + 1);
    return;
  }

  let command: string;
  try {
    command = buildUpdateCommand(host.update_method, plan.mode, plan.allowAutoReboot);
  } catch {
    appendRunJob(runId, "", index + 1);
    runStep(runId, plan, index + 1);
    return;
  }

  const jobId = startUpdateJob(hostId, plan.mode, command, () => {
    setTimeout(() => runStep(runId, plan, index + 1), plan.delaySeconds * 1000);
  });
  appendRunJob(runId, jobId, index);
}
