import { runSshCommand, getHostConnectionInfo, shellQuote } from "../ssh";
import { ensurePrivateKeyDeployed, ensurePublicKeyAuthorized } from "../backup/keys";
import { ensureRemoteDir, ensureRsyncReachable } from "../backup/transfer";
import { updateReplicationStatus, type Replication } from "./replication";

const SETUP_TIMEOUT_MS = 30_000;
const SYNC_TIMEOUT_MS = 60_000;

/** SQLite has no native replication — the realistic fallback (confirmed with the user) is a
 * frequent, consistent snapshot pushed to the target on a timer (lib/ha/scheduler.ts), not true
 * on-change replication. `.backup` is SQLite's own online-backup API (via the sqlite3 CLI): it
 * takes a transactionally-consistent copy even while the source file is being actively written,
 * unlike a plain `cp`/`rsync` of the live file, which can read it mid-write and copy a torn page. */
export async function setupSqliteReplication(r: Replication): Promise<void> {
  updateReplicationStatus(r.id, "setting_up", "Déploiement de la clé SSH dédiée…");
  const keyPath = await ensurePrivateKeyDeployed(r.sourceHostId);
  await ensurePublicKeyAuthorized(r.targetHostId);

  updateReplicationStatus(r.id, "setting_up", "Vérification de rsync sur la machine cible…");
  await ensureRsyncReachable(r.sourceHostId, r.targetHostId, keyPath);

  const targetDir = r.targetPath.slice(0, r.targetPath.lastIndexOf("/")) || "/";
  await ensureRemoteDir(r.sourceHostId, r.targetHostId, targetDir, keyPath);

  updateReplicationStatus(r.id, "setting_up", "Vérification de sqlite3 sur la machine source…");
  const { code: sqliteCheckCode } = await runSshCommand(r.sourceHostId, "command -v sqlite3", { timeoutMs: SETUP_TIMEOUT_MS });
  if (sqliteCheckCode !== 0) {
    throw new Error(
      "sqlite3 n'est pas installé sur la machine source — installe-le (ex. `apt install sqlite3`) puis relance la configuration."
    );
  }

  // First copy right away, synchronously, so the replication starts "in_sync" instead of waiting
  // for the next scheduler tick — same reasoning as every other feature here that runs its own
  // first pass immediately rather than only on a timer.
  await runSqliteSync(r);
}

/** One snapshot-and-push cycle: `.backup` into a temp file on the source, rsync that file over the
 * dedicated key, then remove the temp copy — run entirely as one chained command on the source
 * host so nothing needs a second round trip for cleanup. */
export async function runSqliteSync(r: Replication): Promise<void> {
  const keyPath = await ensurePrivateKeyDeployed(r.sourceHostId);
  const dest = getHostConnectionInfo(r.targetHostId);
  const sshOpts = `-i ${keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -p ${dest.port}`;
  const tmpPath = `/tmp/hlp-sqlite-sync-${r.id}.db`;

  const command = [
    `sqlite3 ${shellQuote(r.sourcePath)} ${shellQuote(`.backup '${tmpPath}'`)}`,
    `rsync -az -e ${shellQuote(`ssh ${sshOpts}`)} ${shellQuote(tmpPath)} ${shellQuote(`${dest.user}@${dest.address}:${r.targetPath}`)}`,
    `rm -f ${shellQuote(tmpPath)}`,
  ].join(" && ");

  const { code, stderr } = await runSshCommand(r.sourceHostId, command, { timeoutMs: SYNC_TIMEOUT_MS });
  if (code !== 0) {
    updateReplicationStatus(r.id, "error", stderr || "Échec de la synchronisation SQLite.");
    throw new Error(stderr || "Échec de la synchronisation SQLite.");
  }
  updateReplicationStatus(r.id, "in_sync", "Dernière copie effectuée avec succès.", true);
}
