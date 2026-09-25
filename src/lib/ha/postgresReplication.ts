import { runSshCommand, getHostConnectionInfo, shellQuote } from "../ssh";
import { ensurePrivateKeyDeployed, ensurePublicKeyAuthorized } from "../backup/keys";
import { ensureRsyncReachable } from "../backup/transfer";
import { restartService, stopService } from "./hostCompat";
import {
  generateReplicationCredential,
  setReplicationCredential,
  getReplicationSecrets,
  updateReplicationStatus,
  resolveTargetCredential,
  type Replication,
} from "./replication";

const SETUP_TIMEOUT_MS = 5 * 60_000;
const STATUS_TIMEOUT_MS = 15_000;

function psql(host: string, port: number, user: string, password: string, sql: string): string {
  return `PGPASSWORD=${shellQuote(password)} psql -h ${shellQuote(host)} -p ${port} -U ${shellQuote(user)} -d postgres -tAc ${shellQuote(sql)}`;
}

/**
 * Sets up native PostgreSQL streaming replication end to end: creates a dedicated replication
 * role and the wal-level settings it needs on the source (both require a restart — `ALTER SYSTEM`
 * writes to postgresql.auto.conf so nothing has to be hand-edited, but wal_level itself only takes
 * effect after the server restarts), authorizes the target's address in pg_hba.conf, then wipes
 * the target's own data directory and rebuilds it from a live `pg_basebackup` streamed straight
 * from the source — `-R` has pg_basebackup write the standby.signal/primary_conninfo files itself
 * (PostgreSQL 12+), which is what makes the target come up already replicating without any config
 * file this code would otherwise have to hand-assemble.
 *
 * **Destructive**: wiping the target's existing data directory is unavoidable — PostgreSQL's own
 * streaming replication requires the replica's data directory to be byte-identical to the source's
 * at the moment replication starts, and pg_basebackup only writes into an empty directory. Callers
 * (the API route) must have already gotten an explicit confirmation for this before calling in.
 */
export async function setupPostgresReplication(r: Replication): Promise<void> {
  const secrets = getReplicationSecrets(r.id);
  if (!r.dbUser || !secrets.dbPassword) {
    throw new Error("Identifiant/mot de passe administrateur PostgreSQL requis pour la machine source pour configurer la réplication.");
  }
  // Only needed for the one query below, before pg_basebackup wipes and rebuilds the target's data
  // directory from the source's — after that, the target *is* a byte copy of the source cluster
  // (roles included), so its admin login becomes identical to the source's for anything checked
  // afterwards (checkPostgresReplicationStatus). This is the one moment the two can still validly
  // differ: the target's own, still-independent PostgreSQL instance, before it's overwritten.
  const targetCred = resolveTargetCredential(r, secrets);
  if (!targetCred.user || !targetCred.password) {
    throw new Error("Identifiant/mot de passe administrateur PostgreSQL requis pour la machine cible (ou laisse ces champs vides pour réutiliser ceux de la source).");
  }
  const port = r.dbPort || 5432;
  const cred = generateReplicationCredential("hlp_repl");
  setReplicationCredential(r.id, cred.user, cred.password);

  updateReplicationStatus(r.id, "setting_up", "Déploiement de la clé SSH dédiée…");
  await ensurePrivateKeyDeployed(r.sourceHostId);
  await ensurePublicKeyAuthorized(r.targetHostId);
  const keyPath = await ensurePrivateKeyDeployed(r.sourceHostId);
  await ensureRsyncReachable(r.sourceHostId, r.targetHostId, keyPath);

  updateReplicationStatus(r.id, "setting_up", "Lecture du dossier de données de la machine cible…");
  const { stdout: targetDataDirOut, code: targetDataDirCode } = await runSshCommand(
    r.targetHostId,
    psql("127.0.0.1", port, targetCred.user, targetCred.password, "SHOW data_directory;"),
    { timeoutMs: STATUS_TIMEOUT_MS }
  );
  if (targetDataDirCode !== 0 || !targetDataDirOut.trim()) {
    throw new Error("Impossible de déterminer le dossier de données PostgreSQL sur la machine cible.");
  }
  const targetDataDir = targetDataDirOut.trim();

  updateReplicationStatus(r.id, "setting_up", "Création du rôle de réplication et activation du WAL sur la source…");
  const source = getHostConnectionInfo(r.sourceHostId);
  const target = getHostConnectionInfo(r.targetHostId);
  const setupSourceSql = [
    `CREATE ROLE ${cred.user} WITH REPLICATION LOGIN PASSWORD '${cred.password.replace(/'/g, "''")}';`,
    `ALTER SYSTEM SET wal_level = 'replica';`,
    `ALTER SYSTEM SET max_wal_senders = 10;`,
    `ALTER SYSTEM SET hot_standby = 'on';`,
  ].join(" ");
  const { code: setupCode, stderr: setupErr } = await runSshCommand(
    r.sourceHostId,
    psql("127.0.0.1", port, r.dbUser, secrets.dbPassword, setupSourceSql),
    { timeoutMs: SETUP_TIMEOUT_MS }
  );
  if (setupCode !== 0) throw new Error(setupErr || "Impossible de créer le rôle de réplication PostgreSQL sur la source.");

  const { stdout: hbaFileOut } = await runSshCommand(
    r.sourceHostId,
    psql("127.0.0.1", port, r.dbUser, secrets.dbPassword, "SHOW hba_file;"),
    { timeoutMs: STATUS_TIMEOUT_MS }
  );
  const hbaFile = hbaFileOut.trim();
  if (!hbaFile) throw new Error("Impossible de localiser pg_hba.conf sur la machine source.");

  const hbaLine = `host replication ${cred.user} ${target.address}/32 md5`;
  const { code: hbaCode, stderr: hbaErr } = await runSshCommand(
    r.sourceHostId,
    `grep -qxF ${shellQuote(hbaLine)} ${shellQuote(hbaFile)} || echo ${shellQuote(hbaLine)} >> ${shellQuote(hbaFile)}`,
    { sudo: true, timeoutMs: STATUS_TIMEOUT_MS }
  );
  if (hbaCode !== 0) throw new Error(hbaErr || "Impossible d'autoriser la machine cible dans pg_hba.conf sur la source.");

  updateReplicationStatus(r.id, "setting_up", "Redémarrage de PostgreSQL sur la source (wal_level)…");
  // Tries systemd, then OpenRC, then SysV `service` (see hostCompat.ts) rather than assuming
  // systemd — PostgreSQL replication stays native-only for now (pg_basebackup needs direct
  // filesystem access to the data directory, unlike the mysql module's docker-exec support), but
  // "native" still spans more than just Debian/Ubuntu.
  const { code: restartCode, stderr: restartErr } = await restartService(r.sourceHostId, "postgresql");
  if (restartCode !== 0) throw new Error(restartErr || "Impossible de redémarrer PostgreSQL sur la machine source.");

  updateReplicationStatus(r.id, "setting_up", "Arrêt de PostgreSQL sur la cible et reconstruction depuis la source (pg_basebackup)…");
  const { code: stopCode, stderr: stopErr } = await stopService(r.targetHostId, "postgresql");
  if (stopCode !== 0) throw new Error(stopErr || "Impossible d'arrêter PostgreSQL sur la machine cible.");

  const basebackupCmd = [
    `rm -rf ${shellQuote(targetDataDir)}/*`,
    `PGPASSWORD=${shellQuote(cred.password)} pg_basebackup -h ${shellQuote(source.address)} -p ${port} -U ${shellQuote(cred.user)} -D ${shellQuote(targetDataDir)} -Fp -Xs -P -R`,
    `chown -R postgres:postgres ${shellQuote(targetDataDir)}`,
    `chmod 700 ${shellQuote(targetDataDir)}`,
  ].join(" && ");
  const { code: basebackupCode, stderr: basebackupErr } = await runSshCommand(r.targetHostId, basebackupCmd, {
    sudo: true,
    timeoutMs: SETUP_TIMEOUT_MS,
  });
  if (basebackupCode !== 0) throw new Error(basebackupErr || "Échec de pg_basebackup depuis la source.");

  updateReplicationStatus(r.id, "setting_up", "Démarrage de PostgreSQL sur la cible en réplique…");
  // restartService also re-enables the service (stopService above disabled it as part of the
  // temporary stop) — ends in the same enabled+running state it started in, across systemd/OpenRC/SysV.
  const { code: startCode, stderr: startErr } = await restartService(r.targetHostId, "postgresql");
  if (startCode !== 0) throw new Error(startErr || "Impossible de démarrer PostgreSQL sur la machine cible.");

  updateReplicationStatus(r.id, "in_sync", "Réplication démarrée.", true);
}

export async function checkPostgresReplicationStatus(r: Replication): Promise<void> {
  const secrets = getReplicationSecrets(r.id);
  if (!r.dbUser || !secrets.dbPassword) {
    updateReplicationStatus(r.id, "error", "Identifiants administrateur manquants pour vérifier l'état.");
    return;
  }
  const port = r.dbPort || 5432;
  const { stdout: recoveryOut, code: recoveryCode, stderr: recoveryErr } = await runSshCommand(
    r.targetHostId,
    psql("127.0.0.1", port, r.dbUser, secrets.dbPassword, "SELECT pg_is_in_recovery();"),
    { timeoutMs: STATUS_TIMEOUT_MS }
  );
  if (recoveryCode !== 0) {
    updateReplicationStatus(r.id, "error", recoveryErr || "Impossible d'interroger la machine cible.");
    return;
  }
  if (recoveryOut.trim() !== "t") {
    updateReplicationStatus(r.id, "error", "La machine cible n'est pas en mode réplique (pg_is_in_recovery = false).");
    return;
  }

  const { stdout: lagOut } = await runSshCommand(
    r.targetHostId,
    psql(
      "127.0.0.1",
      port,
      r.dbUser,
      secrets.dbPassword,
      "SELECT COALESCE(EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())), 0);"
    ),
    { timeoutMs: STATUS_TIMEOUT_MS }
  );
  const lagSeconds = Number(lagOut.trim());
  const lagText = Number.isFinite(lagSeconds) ? `retard : ${Math.round(lagSeconds)}s` : "retard inconnu";
  updateReplicationStatus(r.id, Number.isFinite(lagSeconds) && lagSeconds > 30 ? "lagging" : "in_sync", `Réplication active, ${lagText}.`, true);
}
