import { randomUUID } from "crypto";
import { getDb } from "../db";
import { ensurePrivateKeyDeployed, ensurePublicKeyAuthorized } from "../backup/keys";
import { ensureRemoteDir, ensureRsyncReachable, rsyncTransfer, removeRemotePath } from "../backup/transfer";
import { dumpMailboxes, restoreMailbox } from "../backup/sources/mailbox";
import { runSshCommand } from "../ssh";

export type MailMigrationStatus = "running" | "success" | "failed";

export type MailMigration = {
  id: string;
  sourceHostId: number;
  sourceContainer: string | null;
  sourceMailbox: string;
  destHostId: number;
  destContainer: string | null;
  destMailbox: string;
  status: MailMigrationStatus;
  log: string;
  startedAt: string;
  finishedAt: string | null;
};

type MigrationRow = {
  id: string;
  source_host_id: number;
  source_container: string | null;
  source_mailbox: string;
  dest_host_id: number;
  dest_container: string | null;
  dest_mailbox: string;
  status: MailMigrationStatus;
  log: string;
  started_at: string;
  finished_at: string | null;
};

function rowToMigration(row: MigrationRow): MailMigration {
  return {
    id: row.id,
    sourceHostId: row.source_host_id,
    sourceContainer: row.source_container,
    sourceMailbox: row.source_mailbox,
    destHostId: row.dest_host_id,
    destContainer: row.dest_container,
    destMailbox: row.dest_mailbox,
    status: row.status,
    log: row.log,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function getMigration(id: string): MailMigration | null {
  const row = getDb().prepare(`SELECT * FROM mail_migrations WHERE id = ?`).get(id) as MigrationRow | undefined;
  return row ? rowToMigration(row) : null;
}

export function listMigrations(limit = 20): MailMigration[] {
  return (getDb().prepare(`SELECT * FROM mail_migrations ORDER BY started_at DESC LIMIT ?`).all(limit) as MigrationRow[]).map(
    rowToMigration
  );
}

function appendLog(id: string, text: string): void {
  if (!text) return;
  getDb().prepare(`UPDATE mail_migrations SET log = log || ? WHERE id = ?`).run(text, id);
}

function finish(id: string, status: "success" | "failed"): void {
  getDb().prepare(`UPDATE mail_migrations SET status = ?, finished_at = datetime('now') WHERE id = ?`).run(status, id);
}

export type StartMailMigrationInput = {
  sourceHostId: number;
  sourceDeployment?: "docker" | "native";
  sourceContainerId?: string;
  sourceMailbox: string;
  destHostId: number;
  destDeployment?: "docker" | "native";
  destContainerId?: string;
  destMailbox: string;
};

/**
 * Moves one mailbox directly between two live Dovecot servers, over the same dedicated
 * SSH-key/rsync mechanism the backup engine already uses for host-to-host transfers (Tailscale
 * being the network these panel-managed hosts actually reach each other over, in practice) —
 * dump the mailbox to a Maildir tree on the source, rsync that tree straight onto the
 * destination, restore it into the destination mailbox via doveadm, then clean up both temp
 * copies. No intermediate storage plan is involved: this is a one-off move, not a scheduled
 * backup, so its own progress lives in mail_migrations rather than a backup_runs row.
 */
export function startMailMigration(input: StartMailMigrationInput): string {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO mail_migrations (id, source_host_id, source_container, source_mailbox, dest_host_id, dest_container, dest_mailbox, status, log)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'running', '')`
    )
    .run(
      id,
      input.sourceHostId,
      input.sourceDeployment === "docker" ? input.sourceContainerId ?? null : null,
      input.sourceMailbox,
      input.destHostId,
      input.destDeployment === "docker" ? input.destContainerId ?? null : null,
      input.destMailbox
    );

  const append = (text: string) => appendLog(id, text);

  (async () => {
    let dumpCleanup: string | null = null;
    let tmpDirOnDest: string | null = null;
    try {
      append(`Sauvegarde de ${input.sourceMailbox} sur la machine source...\n`);
      const dumped = await dumpMailboxes(
        input.sourceHostId,
        { deployment: input.sourceDeployment, containerId: input.sourceContainerId, mailboxes: [input.sourceMailbox] },
        append
      );
      dumpCleanup = dumped.cleanup;
      const mailboxDirOnSource = `${dumped.paths[0]}/${input.sourceMailbox}`;

      append(`\nTransfert vers la machine de destination...\n`);
      const keyPath = await ensurePrivateKeyDeployed(input.sourceHostId);
      await ensurePublicKeyAuthorized(input.destHostId);
      await ensureRsyncReachable(input.sourceHostId, input.destHostId, keyPath);
      tmpDirOnDest = `/tmp/homelab-panel-mailmigrate-${id}`;
      await ensureRemoteDir(input.sourceHostId, input.destHostId, tmpDirOnDest, keyPath);
      await rsyncTransfer({
        fromHostId: input.sourceHostId,
        toHostId: input.destHostId,
        sourcePath: mailboxDirOnSource,
        destDir: tmpDirOnDest,
        append,
      });

      append(`\nRestauration dans ${input.destMailbox} sur la machine de destination...\n`);
      await restoreMailbox(
        input.destHostId,
        { deployment: input.destDeployment, containerId: input.destContainerId },
        `${tmpDirOnDest}/${input.sourceMailbox}`,
        input.destMailbox
      );

      append(`\nMigration terminée : ${input.sourceMailbox} -> ${input.destMailbox}.\n`);
      finish(id, "success");
    } catch (err) {
      append(`\nErreur : ${err instanceof Error ? err.message : "inconnue"}\n`);
      finish(id, "failed");
    } finally {
      if (dumpCleanup) {
        await runSshCommand(input.sourceHostId, dumpCleanup).catch(() => {});
      }
      if (tmpDirOnDest) await removeRemotePath(input.destHostId, tmpDirOnDest).catch(() => {});
    }
  })();

  return id;
}
