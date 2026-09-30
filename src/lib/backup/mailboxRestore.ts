import { randomUUID } from "crypto";
import { startRun, appendRunLog, finishRun } from "./runs";
import { rsyncTransfer, removeRemotePath } from "./transfer";
import { restoreMailbox } from "./sources/mailbox";
import { runSshCommand, shellQuote } from "../ssh";

/**
 * Restores one mailbox from a mailbox-source snapshot into a live Dovecot — on the *same* mail
 * server the backup came from (recovering a mailbox someone emptied by accident) or a different
 * one entirely (rebuilding a server from its last backup). The snapshot lives on the backup
 * destination host, not the target, so the relevant Maildir subtree is pulled onto the target
 * first (same rsync-over-ssh mechanism as restoreSnapshotPath) before doveadm can restore *into*
 * it — doveadm always operates locally, it has no notion of a remote source.
 */
export function restoreMailboxFromSnapshot(
  planId: string,
  backupHostId: number,
  snapshotDir: string,
  mailbox: string,
  targetHostId: number,
  targetConfig: { deployment?: "docker" | "native"; containerId?: string },
  targetMailbox: string
): string {
  const runId = startRun(planId);
  const append = (text: string) => appendRunLog(runId, text);
  const tmpDir = `/tmp/homelab-panel-mailrestore-${randomUUID()}`;
  const sourceOnBackup = `${snapshotDir}/${mailbox}`;

  (async () => {
    try {
      append(`Récupération de la boîte ${mailbox} depuis le snapshot vers la machine cible...\n`);
      await runSshCommand(targetHostId, `mkdir -p ${shellQuote(tmpDir)}`, { sudo: true });
      await rsyncTransfer({ fromHostId: backupHostId, toHostId: targetHostId, sourcePath: sourceOnBackup, destDir: tmpDir, append });

      append(`\nRestauration dans la boîte ${targetMailbox} via doveadm...\n`);
      await restoreMailbox(targetHostId, targetConfig, `${tmpDir}/${mailbox}`, targetMailbox);

      await removeRemotePath(targetHostId, tmpDir).catch(() => {});
      append(`\nRestauration terminée.\n`);
      finishRun(runId, "success", snapshotDir, [mailbox]);
    } catch (err) {
      append(`\nErreur : ${err instanceof Error ? err.message : "inconnue"}\n`);
      finishRun(runId, "failed", null, []);
    }
  })();

  return runId;
}
