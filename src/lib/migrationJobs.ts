import { randomUUID } from "crypto";
import { getDb } from "./db";
import { migrateContainer } from "./dockerMigration";
import { migrateVm, type VmMigrationResult } from "./vmMigration";

export type MigrationJob = {
  id: string;
  kind: "docker" | "vm";
  status: "running" | "success" | "failed";
  log: string;
  result: VmMigrationResult | null;
  startedAt: string;
  finishedAt: string | null;
};

type JobRow = {
  id: string;
  kind: "docker" | "vm";
  status: "running" | "success" | "failed";
  log: string;
  result_json: string | null;
  started_at: string;
  finished_at: string | null;
};

function rowToJob(row: JobRow): MigrationJob {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    log: row.log,
    result: row.result_json ? JSON.parse(row.result_json) : null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function getMigrationJob(id: string): MigrationJob | null {
  const row = getDb().prepare(`SELECT * FROM migration_jobs WHERE id = ?`).get(id) as JobRow | undefined;
  return row ? rowToJob(row) : null;
}

function appendLog(jobId: string, text: string) {
  getDb().prepare(`UPDATE migration_jobs SET log = log || ? WHERE id = ?`).run(text, jobId);
}

function finishJob(jobId: string, status: "success" | "failed", result?: unknown) {
  getDb()
    .prepare(`UPDATE migration_jobs SET status = ?, result_json = ?, finished_at = datetime('now') WHERE id = ?`)
    .run(status, result !== undefined ? JSON.stringify(result) : null, jobId);
}

export function startDockerMigrationJob(sourceHostId: number, containerId: string, destHostId: number, removeSource: boolean): string {
  const jobId = randomUUID();
  getDb().prepare(`INSERT INTO migration_jobs (id, kind, status, log) VALUES (?, 'docker', 'running', '')`).run(jobId);

  migrateContainer(sourceHostId, containerId, destHostId, removeSource, (text) => appendLog(jobId, text))
    .then(() => finishJob(jobId, "success"))
    .catch((err) => {
      appendLog(jobId, `\nErreur: ${err instanceof Error ? err.message : "inconnue"}\n`);
      finishJob(jobId, "failed");
    });

  return jobId;
}

export function startVmMigrationJob(
  sourceHostId: number,
  sourceNode: string,
  type: "qemu" | "lxc",
  vmid: number,
  destHostId: number,
  destNode: string,
  opts: { newVmid?: number; storage?: string; online?: boolean }
): string {
  const jobId = randomUUID();
  getDb().prepare(`INSERT INTO migration_jobs (id, kind, status, log) VALUES (?, 'vm', 'running', '')`).run(jobId);

  migrateVm(sourceHostId, sourceNode, type, vmid, destHostId, destNode, opts, (text) => appendLog(jobId, text))
    .then((result) => finishJob(jobId, "success", result))
    .catch((err) => {
      appendLog(jobId, `\nErreur: ${err instanceof Error ? err.message : "inconnue"}\n`);
      finishJob(jobId, "failed");
    });

  return jobId;
}
