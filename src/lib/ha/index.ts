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
import { clearResyncReminder } from "../npmFailover";
import { notifyAll, hasAnyNotificationChannel } from "../notifications/notify";
import { getDb } from "../db";

function hostLabel(hostId: number): string {
  const row = getDb().prepare(`SELECT name FROM hosts WHERE id = ?`).get(hostId) as { name: string } | undefined;
  return row?.name ?? `#${hostId}`;
}

export * from "./replication";
export { wireFailoverForReplication } from "./failoverWiring";
export { PROVISION_PRESETS, PROVISION_PHP_VERSIONS, runProvisioning } from "./provisioning";

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
      // The whole point of a manual reverse sync is fixing exactly the situation the failback
      // reminder warns about — clear it now rather than leaving it flagged after the user already
      // did the thing it was reminding them to do.
      if (r.proxyHostId) clearResyncReminder(r.proxyHostId);
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

type StatusTransition = { direction: "down" | "up"; before: Replication; after: Replication };

// Backs off the automatic 30s sweep (checkAllReplications only — never the manual "Vérifier
// maintenant" action) for a replication whose host keeps failing, instead of retrying it on every
// single tick forever. A replication pointed at a host that's genuinely gone (renamed, decommissioned,
// a stale Tailscale address) used to get a fresh SSH connection attempt every 30s indefinitely, in
// parallel with every other replication/host this sweep touches — exactly the kind of unthrottled
// background load that can grind a VM down over hours with no single action to point at. Doubles the
// wait after each consecutive failure, capped at 10 minutes; a success clears it immediately.
const failureBackoff = new Map<string, { until: number; failCount: number }>();
const BACKOFF_CAP_MS = 10 * 60_000;

function isBackedOff(id: string): boolean {
  const entry = failureBackoff.get(id);
  return !!entry && Date.now() < entry.until;
}

function recordCheckResult(id: string, ok: boolean): void {
  if (ok) {
    failureBackoff.delete(id);
    return;
  }
  const failCount = (failureBackoff.get(id)?.failCount ?? 0) + 1;
  const delay = Math.min(CHECK_INTERVAL_MS * 2 ** (failCount - 1), BACKOFF_CAP_MS);
  failureBackoff.set(id, { until: Date.now() + delay, failCount });
}

/** Runs the actual per-kind check and reports whether that just flipped this replication into or
 * out of an alert-worthy state — without sending anything itself, so callers can either notify
 * immediately (a single manual check) or batch several transitions from the same sweep into one
 * notification per target host (see checkAllReplications). */
async function runStatusCheck(id: string): Promise<StatusTransition | null> {
  const before = getReplication(id);
  if (!before) return null;
  let ok = true;
  try {
    if (before.kind === "folder") await checkFolderReplicationStatus(before);
    else if (before.kind === "sqlite") await runSqliteSync(before);
    else if (before.kind === "mysql") await checkMysqlReplicationStatus(before);
    else await checkPostgresReplicationStatus(before);
  } catch (err) {
    ok = false;
    updateReplicationStatus(id, "error", err instanceof Error ? err.message : "Erreur inconnue lors de la vérification.");
  }
  recordCheckResult(id, ok);

  const after = getReplication(id);
  if (!after) return null;
  const wasDown = ALERT_STATES.includes(before.status);
  const isDown = ALERT_STATES.includes(after.status);
  if (!wasDown && isDown) return { direction: "down", before, after };
  if (wasDown && !isDown) return { direction: "up", before, after };
  return null;
}

/** Single-replication check (the "Vérifier maintenant" action) — notifies straight away, since
 * there's no batch of sibling checks here to group with. */
export async function checkReplicationStatus(id: string): Promise<void> {
  const transition = await runStatusCheck(id);
  if (!transition || !hasAnyNotificationChannel()) return;
  await notifyTransitionGroup(transition.direction, [transition.after]);
}

/** One replication's alert email, or — when several land in the same sweep with the same
 * direction and the same target host — a single grouped one. Several replications sharing a
 * target machine flip together whenever that machine itself has a shared, short-lived incident
 * (a scheduled reboot, a crashed MariaDB restarting...); that's one real event, not N separate
 * ones, and reading N near-identical emails in the same few seconds is exactly what "an alert
 * that's looping" feels like even though each one fired correctly on its own transition. */
async function notifyTransitionGroup(direction: "down" | "up", replications: Replication[]): Promise<void> {
  const byTargetHost = new Map<number, Replication[]>();
  for (const r of replications) {
    const list = byTargetHost.get(r.targetHostId) ?? [];
    list.push(r);
    byTargetHost.set(r.targetHostId, list);
  }

  await Promise.all(
    Array.from(byTargetHost.values()).map(async (group) => {
      const targetLabel = hostLabel(group[0].targetHostId);
      if (group.length === 1) {
        const r = group[0];
        await notifyAll(
          direction === "down" ? `⚠ Réplication en échec : ${r.name}` : `✅ Réplication rétablie : ${r.name}`,
          direction === "down"
            ? `La réplication "${r.name}" (${r.kind}, ${hostLabel(r.sourceHostId)} → ${targetLabel}) vient de passer en erreur.\n\n${r.statusDetail ?? ""}`
            : `La réplication "${r.name}" (${r.kind}, ${hostLabel(r.sourceHostId)} → ${targetLabel}) est de nouveau opérationnelle.`
        ).catch(() => {});
        return;
      }
      const list = group.map((r) => `- ${r.name} (${r.kind}, depuis ${hostLabel(r.sourceHostId)})`).join("\n");
      await notifyAll(
        direction === "down"
          ? `⚠ ${group.length} réplications en échec sur ${targetLabel}`
          : `✅ ${group.length} réplications rétablies sur ${targetLabel}`,
        direction === "down"
          ? `${group.length} réplications ciblant "${targetLabel}" viennent de passer en erreur en même temps — probablement un incident commun à cette machine (redémarrage, coupure réseau, service en cours de récupération...) plutôt que ${group.length} pannes distinctes :\n\n${list}`
          : `${group.length} réplications ciblant "${targetLabel}" sont de nouveau opérationnelles :\n\n${list}`
      ).catch(() => {});
    })
  );
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
  const replications = listReplications().filter((r) => r.enabled && r.status !== "setting_up" && !isBackedOff(r.id));
  const transitions = (await Promise.all(replications.map((r) => runStatusCheck(r.id)))).filter(
    (t): t is StatusTransition => t !== null
  );
  if (transitions.length === 0 || !hasAnyNotificationChannel()) return;

  await Promise.all([
    notifyTransitionGroup(
      "down",
      transitions.filter((t) => t.direction === "down").map((t) => t.after)
    ),
    notifyTransitionGroup(
      "up",
      transitions.filter((t) => t.direction === "up").map((t) => t.after)
    ),
  ]);
}

const CHECK_INTERVAL_MS = 30_000;

let started = false;
export function startHaScheduler(): void {
  if (started) return;
  started = true;
  checkAllReplications().catch(() => {});
  setInterval(() => checkAllReplications().catch(() => {}), CHECK_INTERVAL_MS);
}
