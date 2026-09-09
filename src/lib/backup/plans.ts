import { randomUUID } from "crypto";
import { getDb } from "../db";

export type SourceType = "paths" | "docker" | "database" | "proxmox_vm";
export type Schedule = "manual" | "hourly" | "daily" | "weekly";

export type BackupPlan = {
  id: string;
  name: string;
  sourceHostId: number;
  sourceType: SourceType;
  /** Raw JSON string — shape depends on sourceType, parsed by the matching resolver. */
  sourceConfig: string;
  destHostId: number;
  destPath: string;
  schedule: Schedule;
  retentionCount: number;
  enabled: boolean;
  createdAt: string;
};

type PlanRow = {
  id: string;
  name: string;
  source_host_id: number;
  source_type: SourceType;
  source_config: string;
  dest_host_id: number;
  dest_path: string;
  schedule: Schedule;
  retention_count: number;
  enabled: number;
  created_at: string;
};

function rowToPlan(row: PlanRow): BackupPlan {
  return {
    id: row.id,
    name: row.name,
    sourceHostId: row.source_host_id,
    sourceType: row.source_type,
    sourceConfig: row.source_config,
    destHostId: row.dest_host_id,
    destPath: row.dest_path,
    schedule: row.schedule,
    retentionCount: row.retention_count,
    enabled: !!row.enabled,
    createdAt: row.created_at,
  };
}

export function listPlans(): BackupPlan[] {
  return (getDb().prepare(`SELECT * FROM backup_plans ORDER BY created_at DESC`).all() as PlanRow[]).map(rowToPlan);
}

export function getPlan(id: string): BackupPlan | null {
  const row = getDb().prepare(`SELECT * FROM backup_plans WHERE id = ?`).get(id) as PlanRow | undefined;
  return row ? rowToPlan(row) : null;
}

export function createPlan(input: Omit<BackupPlan, "id" | "createdAt">): BackupPlan {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO backup_plans (id, name, source_host_id, source_type, source_config, dest_host_id, dest_path, schedule, retention_count, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.name,
      input.sourceHostId,
      input.sourceType,
      input.sourceConfig,
      input.destHostId,
      input.destPath,
      input.schedule,
      input.retentionCount,
      input.enabled ? 1 : 0
    );
  return getPlan(id)!;
}

export function updatePlan(id: string, patch: Partial<Omit<BackupPlan, "id" | "createdAt">>): void {
  const current = getPlan(id);
  if (!current) throw new Error("Plan de sauvegarde introuvable.");
  const merged = { ...current, ...patch };
  getDb()
    .prepare(
      `UPDATE backup_plans SET name=?, source_host_id=?, source_type=?, source_config=?, dest_host_id=?, dest_path=?, schedule=?, retention_count=?, enabled=? WHERE id=?`
    )
    .run(
      merged.name,
      merged.sourceHostId,
      merged.sourceType,
      merged.sourceConfig,
      merged.destHostId,
      merged.destPath,
      merged.schedule,
      merged.retentionCount,
      merged.enabled ? 1 : 0,
      id
    );
}

export function deletePlan(id: string): void {
  getDb().prepare(`DELETE FROM backup_plans WHERE id = ?`).run(id);
}
