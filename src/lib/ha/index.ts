import {
  listReplications,
  getReplication,
  deleteReplication as deleteReplicationRow,
  updateReplicationStatus,
  type Replication,
  type ReplicationStatus,
} from "./replication";
import {
  setupFolderReplication,
  checkFolderReplicationStatus,
  teardownFolderReplication,
  reverseSyncFolderReplication,
} from "./folderReplication";
import { setupSqliteReplication, runSqliteSync } from "./sqliteReplication";
import { setupMysqlReplication, checkMysqlReplicationStatus, reverseSyncMysqlReplication } from "./mysqlReplication";
import { setupPostgresReplication, checkPostgresReplicationStatus } from "./postgresReplication";
import { wireFailoverForReplication } from "./failoverWiring";
import { notifyAll, hasAnyNotificationChannel } from "../notifications/notify";
import { getDb } from "../db";

function hostLabel(hostId: number): string {
  const row = getDb().prepare(`SELECT name FROM hosts WHERE id = ?`).get(hostId) as { name: string } | undefined;
  return row?.name ?? `#${hostId}`;
}

export * from "./replication";
export { wireFailoverForReplication } from "./failoverWiring";

/** Only 'postgres' setup is destructive to the target today (it wipes and rebuilds the target's
 * data directory from scratch — see postgresReplication.ts's own doc comment for why that's
 * unavoidable for PostgreSQL's streaming replication). Callers must have gotten an explicit
 * confirmation from the user before calling runSetup for this kind. */
export function replicationSetupIsDestructive(kind: Replication["kind"]): boolean {
  return kind === "postgres";
}

// Guards against two overlapping runs of the *same* replication's setup — nothing previously
// stopped a second "Configurer" click (a genuine double-click, a page reload followed by a retry,
// a slow first attempt that looked stuck) from firing off a second background run while the first
// was still mid-flight, since setup is fired-and-forgotten from the API route rather than awaited.
// Two independent runs racing to dump/wipe/restore the *same* target tables is exactly what
// produced confusing "table already exists" failures fully unrelated to the actual bug being fixed
// at the time. Deliberately in-memory rather than a DB flag: it only needs to survive for this one
// Node process's lifetime, and resetting empty on every restart/redeploy is the right behavior — a
// run that really did crash/vanish (the process died mid-setup) shouldn't leave the replication
// permanently unable to retry just because its `status` column was never updated past "setting_up".
const activeSetups = new Set<string>();

export function isReplicationSetupRunning(id: string): boolean {
  return activeSetups.has(id);
}

export async function runReplicationSetup(id: string): Promise<void> {
  if (activeSetups.has(id)) {
    throw new Error("Une configuration est déjà en cours pour cette réplication — attends qu'elle se termine avant d'en relancer une.");
  }
  activeSetups.add(id);
  try {
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
    await finishReplicationSetup(id, r);
  } finally {
    activeSetups.delete(id);
  }
}

/** 'folder' and 'mysql' only today — the two kinds this panel's actual users have needed a manual
 * fail-back for so far. 'postgres' streaming replication and 'sqlite''s plain periodic copy would
 * each need their own reverse-flow implementation; asking for one on an unsupported kind fails
 * loudly rather than silently doing nothing. */
export function reverseSyncSupported(kind: Replication["kind"]): boolean {
  return kind === "folder" || kind === "mysql";
}

/** Manual recovery action for after a failover: overwrites the source with the target's current
 * data, on the assumption that real writes happened on the target while the source was down (see
 * reverseSyncFolderReplication/reverseSyncMysqlReplication's own doc comments for exactly how each
 * kind does this). Shares the same in-memory lock as a normal setup — the two must never run
 * concurrently against the same replication's source/target pair, whichever direction each is
 * currently moving data in. */
export async function runReverseSync(id: string): Promise<void> {
  if (activeSetups.has(id)) {
    throw new Error("Une opération est déjà en cours pour cette réplication — attends qu'elle se termine avant d'en relancer une.");
  }
  activeSetups.add(id);
  try {
    const r = getReplication(id);
    if (!r) throw new Error("Réplication introuvable.");
    if (!reverseSyncSupported(r.kind)) {
      throw new Error(`La resynchronisation manuelle n'est pas encore disponible pour le type "${r.kind}".`);
    }
    try {
      if (r.kind === "folder") await reverseSyncFolderReplication(r);
      else await reverseSyncMysqlReplication(r);
    } catch (err) {
      updateReplicationStatus(id, "error", err instanceof Error ? err.message : "Erreur inconnue lors de la resynchronisation.");
      throw err;
    }
  } finally {
    activeSetups.delete(id);
  }
}

async function finishReplicationSetup(id: string, r: Replication): Promise<void> {
  // The replication itself succeeded (its own status is already "in_sync") — wiring the failover
  // is a best-effort extra step on top, not something that should undo or mask that success if it
  // fails (a misconfigured NPM host shouldn't make a healthy replication look broken).
  if (r.proxyHostId) {
    try {
      await wireFailoverForReplication(r);
      const after = getReplication(id);
      updateReplicationStatus(id, "in_sync", `${after?.statusDetail ?? ""} Failover NPM branché sur la machine cible.`.trim());
    } catch (err) {
      const after = getReplication(id);
      updateReplicationStatus(
        id,
        "in_sync",
        `${after?.statusDetail ?? ""} ⚠ Échec du branchement automatique du failover : ${
          err instanceof Error ? err.message : "erreur inconnue"
        }`.trim()
      );
    }
  }
}

// Alert-worthy states — "lagging" is a soft warning (behind schedule, still working) rather than
// broken, so it deliberately doesn't trigger its own notification either way; only a genuine
// failure/stop does, and only crossing the boundary into or out of it, never on every 30s tick
// while it stays there (which is how often this runs — see checkAllReplications).
const ALERT_STATES: ReplicationStatus[] = ["error", "stopped"];

export async function checkReplicationStatus(id: string): Promise<void> {
  const before = getReplication(id);
  if (!before) return;
  try {
    if (before.kind === "folder") await checkFolderReplicationStatus(before);
    else if (before.kind === "sqlite") await runSqliteSync(before);
    else if (before.kind === "mysql") await checkMysqlReplicationStatus(before);
    else await checkPostgresReplicationStatus(before);
  } catch (err) {
    updateReplicationStatus(id, "error", err instanceof Error ? err.message : "Erreur inconnue lors de la vérification.");
  }

  if (!hasAnyNotificationChannel()) return;
  const after = getReplication(id);
  if (!after) return;
  const wasDown = ALERT_STATES.includes(before.status);
  const isDown = ALERT_STATES.includes(after.status);
  if (!wasDown && isDown) {
    notifyAll(
      `⚠ Réplication en échec : ${after.name}`,
      `La réplication "${after.name}" (${after.kind}, ${hostLabel(after.sourceHostId)} → ${hostLabel(after.targetHostId)}) vient de passer en erreur.\n\n${after.statusDetail ?? ""}`
    ).catch(() => {});
  } else if (wasDown && !isDown) {
    notifyAll(
      `✅ Réplication rétablie : ${after.name}`,
      `La réplication "${after.name}" (${after.kind}, ${hostLabel(after.sourceHostId)} → ${hostLabel(after.targetHostId)}) est de nouveau opérationnelle.`
    ).catch(() => {});
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
