import { getPlan } from "./plans";
import { startRun, appendRunLog, finishRun, isRunInProgress } from "./runs";
import { rsyncTransfer, listRemoteDirs, removeRemotePath } from "./transfer";
import { resolveDockerPaths, type DockerBackupConfig } from "./sources/docker";
import { dumpDatabase, type DatabaseBackupConfig } from "./sources/database";
import { dumpProxmoxVm, type ProxmoxVmBackupConfig } from "./sources/proxmox";
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
  append: (text: string) => void
): Promise<void> {
  for (const raw of paths) {
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

/** Runs one backup plan end to end: resolves its source into plain paths, rsyncs each into a
 * fresh timestamped, hardlink-versioned snapshot directory, then prunes old snapshots. */
export async function runBackupPlan(planId: string): Promise<string> {
  const plan = getPlan(planId);
  if (!plan) throw new Error("Plan de sauvegarde introuvable.");
  if (isRunInProgress(planId)) throw new Error("Une sauvegarde pour ce plan est déjà en cours.");

  const runId = startRun(planId);
  const append = (text: string) => appendRunLog(runId, text);

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
        default:
          throw new Error(`Type de source inconnu : ${plan.sourceType}`);
      }

      if (paths.length === 0) throw new Error("Rien à sauvegarder (aucun chemin résolu).");

      await copyPathsIntoSnapshot(plan.sourceHostId, plan.destHostId, paths, newSnapshotDir, previousSnapshotDir, append);

      if (cleanup) {
        await runSshCommand(plan.sourceHostId, cleanup, { sudo: true }).catch(() => {});
      }

      await pruneOldSnapshots(plan.destHostId, planBaseDir, plan.retentionCount, append);

      append(`\nTerminé avec succès. Snapshot : ${newSnapshotDir}\n`);
      finishRun(runId, "success", newSnapshotDir, paths);
    } catch (err) {
      append(`\nErreur : ${err instanceof Error ? err.message : "inconnue"}\n`);
      finishRun(runId, "failed", null, []);
    }
  })();

  return runId;
}
