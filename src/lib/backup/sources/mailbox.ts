import { randomUUID } from "crypto";
import { runSshCommand, shellQuote } from "../../ssh";

export type MailboxBackupConfig = {
  /** "docker" (Mailcow's own deployment, the common case) runs doveadm via `docker exec` inside
   * containerId; "native" runs it directly on the host's own shell, for a Dovecot installed
   * straight on the OS. */
  deployment?: "docker" | "native";
  containerId?: string;
  /** "all" backs up every mailbox Dovecot's userdb knows about; a fixed list backs up only those
   * addresses — picking a handful out of a large install without a dump per unrelated mailbox. */
  mailboxes: "all" | string[];
};

/** Wraps a doveadm invocation for wherever Dovecot actually lives — same reasoning and shape as
 * database.ts's wrapDbCommand. doveadm itself needs to run as a user that can access every
 * mailbox's storage (root, in practice, on both Mailcow's own container and a native install). */
function wrapDoveadmCommand(config: Pick<MailboxBackupConfig, "deployment" | "containerId">, args: string): string {
  if (config.deployment === "native") {
    return `doveadm ${args}`;
  }
  if (!config.containerId) throw new Error("Conteneur Dovecot manquant pour ce plan.");
  return `docker exec ${shellQuote(config.containerId)} doveadm ${args}`;
}

/** Lists every mailbox Dovecot's userdb recognizes — powers the "Tester la connexion" equivalent
 * in the plan editor (picking addresses off a real list instead of typing them blind) and resolves
 * "all" at backup/migration time. */
export async function listMailboxes(
  hostId: number,
  params: Pick<MailboxBackupConfig, "deployment" | "containerId">
): Promise<string[]> {
  const cmd = wrapDoveadmCommand(params, `user '*'`);
  const { stdout, stderr, code } = await runSshCommand(hostId, cmd, { sudo: true });
  if (code !== 0) throw new Error(stderr.trim() || "Impossible de lister les boîtes mail (doveadm introuvable ou inaccessible).");
  return stdout.split("\n").map((l) => l.trim()).filter(Boolean).sort();
}

function resolveMailboxDir(baseDir: string, mailbox: string): string {
  // '/' would otherwise be read as a path separator inside the per-mailbox subdirectory name —
  // mailbox addresses never legitimately contain one, so this only ever fires on a typo/garbage
  // input, not a real address.
  if (mailbox.includes("/")) throw new Error(`Adresse de boîte mail invalide : ${mailbox}`);
  return `${baseDir}/${mailbox}`;
}

/** Dumps one or more mailboxes to a plain Maildir tree via `doveadm backup` — dsync's own format,
 * portable and re-importable with the same tool in reverse (see restoreMailbox below), and
 * incremental in spirit even though each run here is a fresh full dump: dsync only transfers the
 * messages/flags that actually differ from what's already at the destination, so re-running this
 * against the *same* directory on a future run (rather than a fresh timestamped one) would be
 * fast — this panel's snapshot-per-run retention model always dumps to a new directory instead,
 * trading that speed for every snapshot staying independently restorable on its own. */
export async function dumpMailboxes(
  hostId: number,
  config: MailboxBackupConfig,
  append: (text: string) => void
): Promise<{ paths: string[]; cleanup: string }> {
  const mailboxes = config.mailboxes === "all" ? await listMailboxes(hostId, config) : config.mailboxes;
  if (mailboxes.length === 0) throw new Error("Aucune boîte mail à sauvegarder.");

  const dumpDir = `/tmp/homelab-panel-mailbackup-${randomUUID()}`;
  await runSshCommand(hostId, `mkdir -p ${shellQuote(dumpDir)}`, { sudo: true });

  for (const mailbox of mailboxes) {
    append(`Sauvegarde de la boîte ${mailbox}...\n`);
    const mailboxDir = resolveMailboxDir(dumpDir, mailbox);
    const cmd = wrapDoveadmCommand(config, `backup -u ${shellQuote(mailbox)} maildir:${shellQuote(mailboxDir)}`);
    const { code, stderr } = await runSshCommand(hostId, cmd, { sudo: true });
    if (code !== 0) throw new Error(`Échec de la sauvegarde de ${mailbox} : ${stderr.trim() || "erreur doveadm inconnue."}`);
  }

  return { paths: [dumpDir], cleanup: `rm -rf ${shellQuote(dumpDir)}` };
}

/**
 * Restores one mailbox from a Maildir tree (produced by dumpMailboxes, or by the same step of a
 * migration) back into a live Dovecot — `-R` reverses dsync's usual direction, merging the
 * Maildir's content *into* the target mailbox instead of dumping the mailbox out to it. Additive:
 * existing mail in the target mailbox is kept, matching messages are recognized by dsync (not
 * duplicated), and messages that exist only in the backup are added — the safer default for
 * restoring into a mailbox that may have kept receiving mail since the backup was taken (as
 * opposed to a destructive wipe-then-restore, which would throw that mail away).
 */
export async function restoreMailbox(
  hostId: number,
  config: Pick<MailboxBackupConfig, "deployment" | "containerId">,
  mailboxDir: string,
  targetMailbox: string
): Promise<void> {
  const cmd = wrapDoveadmCommand(config, `backup -R -u ${shellQuote(targetMailbox)} maildir:${shellQuote(mailboxDir)}`);
  const { code, stderr } = await runSshCommand(hostId, cmd, { sudo: true, timeoutMs: 30 * 60_000 });
  if (code !== 0) throw new Error(stderr.trim() || `Échec de la restauration dans ${targetMailbox}.`);
}
