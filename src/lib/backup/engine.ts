import { getPlan } from "./plans";
import { startRun, appendRunLog, finishRun, isRunInProgress } from "./runs";
import { rsyncTransfer, listRemoteDirs, removeRemotePath } from "./transfer";
import { resolveDockerPaths, type DockerBackupConfig } from "./sources/docker";
import { dumpDatabase, type DatabaseBackupConfig } from "./sources/database";
import { dumpProxmoxVm, type ProxmoxVmBackupConfig } from "./sources/proxmox";
import { dumpPanelConfig, type PanelConfigBackupConfig } from "./sources/panelConfig";
import { runSshCommand } from "../ssh";

export function joinRemote(base: string, sub: string): string {
  return `${base.replace(/\/+$/, "")}${sub.startsWith("/") ? sub : `/${sub}`}`;
}

export function parentOf(cleanPath: string): string {
  const idx = cleanPath.lastIndexOf("/");
  return idx <= 0 ? "/" : cleanPath.slice(0, idx);
}

/** Snapshot directories are named after their creation time, so lexical order == chronological order. */
function timestampName(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function copyPathsIntoSnapshot(
  sourceHostId: number,
  destHostId: number,
  paths: string[],
  snapshotDir: string,
  previousSnapshotDir: string | null,
  append: (text: string) => void,
  signal: AbortSignal
): Promise<void> {
  for (const raw of paths) {
    if (signal.aborted) throw new Error("Annulé par l'utilisateur.");
    const clean = raw.replace(/\/+$/, "");
    if (!clean) continue;
    const parent = parentOf(clean);
    const destDir = joinRemote(snapshotDir, parent);
    const linkDestDir = previousSnapshotDir ? joinRemote(previousSnapshotDir, parent) : null;
    await rsyncTransfer({
      fromHostId: sourceHostId,
      toHostId: destHostId,
      sourcePath: clean,
      destDir,
      linkDestDir,
      append,
      signal,
    });
  }
}

async function pruneOldSnapshots(
  destHostId: number,
  planBaseDir: string,
  retentionCount: number,
  append: (text: string) => void
): Promise<void> {
  const dirs = await listRemoteDirs(destHostId, planBaseDir);
  if (dirs.length <= retentionCount) return;
  const toRemove = dirs.slice(0, dirs.length - retentionCount);
  for (const dir of toRemove) {
    append(`Suppression de l'ancienne sauvegarde ${dir} (rétention : ${retentionCount} versions).\n`);
    await removeRemotePath(destHostId, joinRemote(planBaseDir, dir));
  }
}

// One AbortController per currently-running backup, keyed by run id — lets a user cancel a
// specific run from the UI (see cancelBackupRun) without touching any other run in flight. Purely
// in-memory: it only needs to reach the streaming SSH call still open in this same Node process,
// and naturally has nothing left to cancel after a restart (the run itself would already show as
// interrupted from a dropped connection at that point anyway).
const activeRuns = new Map<string, AbortController>();

/** Cancels a running backup — closes its SSH connection outright (see runSshCommandStreaming's own
 * comment for why that's used instead of trying to signal the remote process), which reliably kills
 * whatever rsync/mysqldump/etc. was reading from or writing to it on the next broken-pipe write.
 * A no-op, not an error, for a run that already finished or was never tracked here (already gone by
 * the time the request arrived is an unremarkable race, not a bug to report). */
export function cancelBackupRun(runId: string): void {
  const controller = activeRuns.get(runId);
  if (controller) {
    controller.abort();
    return;
  }
  // No controller tracked for this run — either it already finished (the caller already checked
  // status === "running" before calling this, but a race between that check and this call is
  // harmless either way), or, more commonly in practice, the panel's own process restarted
  // (redeploy, crash) while this run was still going: the in-memory tracking is gone, but nothing
  // ever went back and marked the DB row as anything other than "running", so it sits there looking
  // perpetually in-progress with no real process left to cancel. Force-finish it here rather than
  // silently no-op — leaving "Interrompre" do nothing with no explanation is worse than a slightly
  // approximate failure record for a run that's actually long dead.
  appendRunLog(
    runId,
    "\nSauvegarde marquée comme interrompue — son suivi a été perdu (probablement un redémarrage du panel pendant qu'elle tournait), il n'y avait plus de processus réel à annuler.\n"
  );
  finishRun(runId, "failed", null, []);
}

/** Runs one backup plan end to end: resolves its source into plain paths, rsyncs each into a
 * fresh timestamped, hardlink-versioned snapshot directory, then prunes old snapshots. */
export async function runBackupPlan(planId: string): Promise<string> {
  const plan = getPlan(planId);
  if (!plan) throw new Error("Plan de sauvegarde introuvable.");
  if (isRunInProgress(planId)) throw new Error("Une sauvegarde pour ce plan est déjà en cours.");

  const runId = startRun(planId);
  const append = (text: string) => appendRunLog(runId, text);
  const controller = new AbortController();
  activeRuns.set(runId, controller);

  (async () => {
    let cleanup = "";
    try {
      append(`Sauvegarde "${plan.name}" démarrée.\n`);

      const planBaseDir = joinRemote(plan.destPath, plan.id);
      const previousDirs = await listRemoteDirs(plan.destHostId, planBaseDir);
      const previousSnapshotDir = previousDirs.length > 0 ? joinRemote(planBaseDir, previousDirs[previousDirs.length - 1]) : null;
      const newSnapshotDir = joinRemote(planBaseDir, timestampName());

      let paths: string[];
      switch (plan.sourceType) {
        case "paths": {
          const cfg = JSON.parse(plan.sourceConfig) as { paths: string[] };
          paths = cfg.paths;
          break;
        }
        case "docker": {
          const cfg = JSON.parse(plan.sourceConfig) as DockerBackupConfig;
          const resolved = await resolveDockerPaths(plan.sourceHostId, cfg, append);
          paths = resolved.paths;
          cleanup = resolved.cleanup;
          break;
        }
        case "database": {
          const cfg = JSON.parse(plan.sourceConfig) as DatabaseBackupConfig;
          const resolved = await dumpDatabase(plan.sourceHostId, cfg, append);
          paths = resolved.paths;
          cleanup = resolved.cleanup;
          break;
        }
        case "proxmox_vm": {
          const cfg = JSON.parse(plan.sourceConfig) as ProxmoxVmBackupConfig;
          const resolved = await dumpProxmoxVm(plan.sourceHostId, cfg, append);
          paths = resolved.paths;
          cleanup = resolved.cleanup;
          break;
        }
        case "panel_config": {
          const cfg = JSON.parse(plan.sourceConfig || "{}") as PanelConfigBackupConfig;
          const resolved = await dumpPanelConfig(plan.sourceHostId, cfg, append);
          paths = resolved.paths;
          cleanup = resolved.cleanup;
          break;
        }
        default:
          throw new Error(`Type de source inconnu : ${plan.sourceType}`);
      }

      if (paths.length === 0) throw new Error("Rien à sauvegarder (aucun chemin résolu).");

      await copyPathsIntoSnapshot(plan.sourceHostId, plan.destHostId, paths, newSnapshotDir, previousSnapshotDir, append, controller.signal);

      if (cleanup) {
        await runSshCommand(plan.sourceHostId, cleanup, { sudo: true }).catch(() => {});
      }

      await pruneOldSnapshots(plan.destHostId, planBaseDir, plan.retentionCount, append);

      append(`\nTerminé avec succès. Snapshot : ${newSnapshotDir}\n`);
      finishRun(runId, "success", newSnapshotDir, paths);
    } catch (err) {
      const cancelled = controller.signal.aborted;
      append(`\n${cancelled ? "Sauvegarde annulée par l'utilisateur." : `Erreur : ${err instanceof Error ? err.message : "inconnue"}`}\n`);
      finishRun(runId, "failed", null, []);
    } finally {
      activeRuns.delete(runId);
    }
  })();

  return runId;
}
