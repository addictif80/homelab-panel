import { startRun, appendRunLog, finishRun } from "./runs";
import { rsyncTransfer } from "./transfer";
import { joinRemote, parentOf } from "./engine";

/**
 * Pulls one backed-up path back down from a snapshot into a chosen host/directory. The backup
 * destination host pushes the data (same rsync-over-ssh mechanism as a backup, just reversed),
 * so the panel is never in the data path either way.
 */
export function restoreSnapshotPath(
  planId: string,
  backupHostId: number,
  snapshotDir: string,
  originalPath: string,
  targetHostId: number,
  targetParentDir?: string
): string {
  const clean = originalPath.replace(/\/+$/, "");
  const parent = targetParentDir || parentOf(clean);
  const sourceOnBackup = joinRemote(snapshotDir, clean);

  const runId = startRun(planId);
  const append = (text: string) => appendRunLog(runId, text);

  (async () => {
    try {
      append(`Restauration de ${clean} depuis ${snapshotDir} vers la machine cible (${parent})...\n`);
      await rsyncTransfer({
        fromHostId: backupHostId,
        toHostId: targetHostId,
        sourcePath: sourceOnBackup,
        destDir: parent,
        append,
      });
      append(`\nRestauration terminée.\n`);
      finishRun(runId, "success", snapshotDir, [clean]);
    } catch (err) {
      append(`\nErreur : ${err instanceof Error ? err.message : "inconnue"}\n`);
      finishRun(runId, "failed", null, []);
    }
  })();

  return runId;
}
