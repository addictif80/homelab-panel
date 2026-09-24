import {
  listReplications,
  getReplication,
  deleteReplication as deleteReplicationRow,
  updateReplicationStatus,
  type Replication,
} from "./replication";
import { setupFolderReplication, checkFolderReplicationStatus, teardownFolderReplication } from "./folderReplication";
import { setupSqliteReplication, runSqliteSync } from "./sqliteReplication";
import { setupMysqlReplication, checkMysqlReplicationStatus } from "./mysqlReplication";
import { setupPostgresReplication, checkPostgresReplicationStatus } from "./postgresReplication";

export * from "./replication";

/** Only 'postgres' setup is destructive to the target today (it wipes and rebuilds the target's
 * data directory from scratch — see postgresReplication.ts's own doc comment for why that's
 * unavoidable for PostgreSQL's streaming replication). Callers must have gotten an explicit
 * confirmation from the user before calling runSetup for this kind. */
export function replicationSetupIsDestructive(kind: Replication["kind"]): boolean {
  return kind === "postgres";
}

export async function runReplicationSetup(id: string): Promise<void> {
  const r = getReplication(id);
  if (!r) throw new Error("Réplication introuvable.");
  try {
    if (r.kind === "folder") await setupFolderReplication(r);
    else if (r.kind === "sqlite") await setupSqliteReplication(r);
    else if (r.kind === "mysql") await setupMysqlReplication(r);
    else await setupPostgresReplication(r);
  } catch (err) {
    updateReplicationStatus(id, "error", err instanceof Error ? err.message : "Erreur inconnue lors de la configuration.");
    throw err;
  }
}

export async function checkReplicationStatus(id: string): Promise<void> {
  const r = getReplication(id);
  if (!r) return;
  try {
    if (r.kind === "folder") await checkFolderReplicationStatus(r);
    else if (r.kind === "sqlite") await runSqliteSync(r);
    else if (r.kind === "mysql") await checkMysqlReplicationStatus(r);
    else await checkPostgresReplicationStatus(r);
  } catch (err) {
    updateReplicationStatus(id, "error", err instanceof Error ? err.message : "Erreur inconnue lors de la vérification.");
  }
}

/**
 * Removes a replication from the panel. For 'folder', the source host's lsyncd config is
 * regenerated without this entry first — otherwise the machine would keep pushing to a target the
 * panel no longer knows about. For 'mysql'/'postgres'/'sqlite', only the panel's own record is
 * removed: the underlying database replication (if already running) keeps running until someone
 * tears it down on the servers themselves — undoing a live source/replica setup safely (STOP SLAVE,
 * demoting a standby, deciding what happens to already-replicated data) is a decision for whoever
 * runs those servers, not something this panel should do silently as a side effect of deleting a
 * row.
 */
export async function removeReplication(id: string): Promise<void> {
  const r = getReplication(id);
  if (!r) return;
  if (r.kind === "folder") {
    await teardownFolderReplication(r.sourceHostId).catch(() => {});
  }
  deleteReplicationRow(id);
}

/** Every enabled replication, checked/synced in parallel — best-effort per entry, same shape as
 * every other multi-host sweep in this app. 'folder' replications run continuously via lsyncd
 * already; this only refreshes their displayed status. 'sqlite' has no continuous mechanism at
 * all, so this is what actually performs its next sync, not just a status check. */
export async function checkAllReplications(): Promise<void> {
  const replications = listReplications().filter((r) => r.enabled && r.status !== "setting_up");
  await Promise.all(replications.map((r) => checkReplicationStatus(r.id)));
}

const CHECK_INTERVAL_MS = 30_000;

let started = false;
export function startHaScheduler(): void {
  if (started) return;
  started = true;
  checkAllReplications().catch(() => {});
  setInterval(() => checkAllReplications().catch(() => {}), CHECK_INTERVAL_MS);
}
