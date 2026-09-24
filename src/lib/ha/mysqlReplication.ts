import { runSshCommand, getHostConnectionInfo, shellQuote } from "../ssh";
import { ensurePrivateKeyDeployed, ensurePublicKeyAuthorized } from "../backup/keys";
import { ensureRemoteDir, ensureRsyncReachable } from "../backup/transfer";
import {
  generateReplicationCredential,
  setReplicationCredential,
  getReplicationSecrets,
  updateReplicationStatus,
  type Replication,
} from "./replication";

const SETUP_TIMEOUT_MS = 5 * 60_000;
const STATUS_TIMEOUT_MS = 15_000;

/** Debian/Ubuntu's MariaDB and MySQL packages each ship their own conf.d directory (only one of
 * which exists on a given host, depending which engine is actually installed) — tried in order
 * rather than assumed, since guessing wrong means writing a config file nothing ever reads. */
async function findMysqlConfDir(hostId: number): Promise<string> {
  const candidates = ["/etc/mysql/mariadb.conf.d", "/etc/mysql/mysql.conf.d", "/etc/mysql/conf.d"];
  for (const dir of candidates) {
    const { code } = await runSshCommand(hostId, `test -d ${shellQuote(dir)}`, { timeoutMs: STATUS_TIMEOUT_MS });
    if (code === 0) return dir;
  }
  throw new Error(
    "Impossible de trouver le dossier de configuration MySQL/MariaDB (/etc/mysql/*.conf.d) sur cette machine — l'installation ne correspond pas au paquet Debian/Ubuntu standard."
  );
}

/** Both `mariadb`/`mysql` are tried as the service name — the package renamed the systemd unit
 * across versions/distros, and probing which one actually exists is more reliable than assuming. */
async function restartMysqlService(hostId: number): Promise<void> {
  const { code, stderr } = await runSshCommand(
    hostId,
    `systemctl restart mariadb 2>/dev/null || systemctl restart mysql 2>/dev/null`,
    { sudo: true, timeoutMs: SETUP_TIMEOUT_MS }
  );
  if (code !== 0) throw new Error(stderr || "Impossible de redémarrer le service MySQL/MariaDB sur cette machine.");
}

function mysqlCommand(host: string, port: number, user: string, password: string): string {
  return `MYSQL_PWD=${shellQuote(password)} mysql -h ${shellQuote(host)} -P ${port} -u ${shellQuote(user)}`;
}

/**
 * Sets up native MySQL/MariaDB source→replica replication end to end: enables binary logging on
 * the source (a dedicated include file + restart, since it's normally off by default and can't be
 * turned on with a runtime SET), creates a narrowly-scoped replication role, takes a single
 * consistent dump with its exact binlog coordinates embedded, ships it to the target over the
 * dedicated replication SSH key, restores it there, then points the target's own replication
 * thread at the source using those exact coordinates. Everything after this runs inside MySQL's
 * own replication stream — nothing here needs to run again on a timer (unlike the SQLite fallback).
 */
export async function setupMysqlReplication(r: Replication): Promise<void> {
  const secrets = getReplicationSecrets(r.id);
  if (!r.dbUser || !secrets.dbPassword) {
    throw new Error("Identifiant/mot de passe administrateur MySQL requis (valides sur les deux machines) pour configurer la réplication.");
  }
  const port = r.dbPort || 3306;
  const cred = generateReplicationCredential("hlp_repl");
  setReplicationCredential(r.id, cred.user, cred.password);

  updateReplicationStatus(r.id, "setting_up", "Déploiement de la clé SSH dédiée…");
  const keyPath = await ensurePrivateKeyDeployed(r.sourceHostId);
  await ensurePublicKeyAuthorized(r.targetHostId);
  await ensureRsyncReachable(r.sourceHostId, r.targetHostId, keyPath);

  updateReplicationStatus(r.id, "setting_up", "Activation du binlog sur la machine source…");
  const confDir = await findMysqlConfDir(r.sourceHostId);
  // server-id must be unique among every server in the replication topology — derived from the
  // host id (offset to stay clear of MySQL's reserved id 0) rather than hardcoded, so two
  // replications from different source hosts never collide.
  const serverId = 1000 + r.sourceHostId;
  const binlogConf = `[mariadb]\nserver-id = ${serverId}\nlog_bin = /var/log/mysql/mysql-bin.log\nbinlog_do_db = ${r.sourcePath}\n`;
  const writeConf = `cat > ${confDir}/99-homelab-panel-ha.cnf <<'HLP_MYSQL_CONF_EOF'\n${binlogConf}\nHLP_MYSQL_CONF_EOF`;
  const { code: writeConfCode, stderr: writeConfErr } = await runSshCommand(r.sourceHostId, writeConf, {
    sudo: true,
    timeoutMs: SETUP_TIMEOUT_MS,
  });
  if (writeConfCode !== 0) throw new Error(writeConfErr || "Impossible d'écrire la configuration de réplication MySQL sur la machine source.");
  await restartMysqlService(r.sourceHostId);

  updateReplicationStatus(r.id, "setting_up", "Création du rôle de réplication…");
  const grantSql = `CREATE USER IF NOT EXISTS ${shellQuote(cred.user)}@'%' IDENTIFIED BY ${shellQuote(cred.password)}; GRANT REPLICATION SLAVE ON *.* TO ${shellQuote(cred.user)}@'%'; FLUSH PRIVILEGES;`;
  const { code: grantCode, stderr: grantErr } = await runSshCommand(
    r.sourceHostId,
    `echo ${shellQuote(grantSql)} | ${mysqlCommand("127.0.0.1", port, r.dbUser, secrets.dbPassword)}`,
    { timeoutMs: SETUP_TIMEOUT_MS }
  );
  if (grantCode !== 0) throw new Error(grantErr || "Impossible de créer le rôle de réplication MySQL.");

  updateReplicationStatus(r.id, "setting_up", "Export initial de la base…");
  const dumpPath = `/tmp/hlp-mysql-dump-${r.id}.sql`;
  const dumpCmd = `MYSQL_PWD=${shellQuote(secrets.dbPassword)} mysqldump -h 127.0.0.1 -P ${port} -u ${shellQuote(r.dbUser)} --single-transaction --master-data=2 --databases ${shellQuote(r.sourcePath)} > ${shellQuote(dumpPath)}`;
  const { code: dumpCode, stderr: dumpErr } = await runSshCommand(r.sourceHostId, dumpCmd, { timeoutMs: SETUP_TIMEOUT_MS });
  if (dumpCode !== 0) throw new Error(dumpErr || "Échec de l'export initial de la base MySQL.");

  const { stdout: coordLine } = await runSshCommand(
    r.sourceHostId,
    `grep -m1 "CHANGE MASTER TO" ${shellQuote(dumpPath)}`,
    { timeoutMs: STATUS_TIMEOUT_MS }
  );
  const coordMatch = coordLine.match(/MASTER_LOG_FILE='([^']+)',\s*MASTER_LOG_POS=(\d+)/);
  if (!coordMatch) {
    await runSshCommand(r.sourceHostId, `rm -f ${shellQuote(dumpPath)}`);
    throw new Error("Impossible de déterminer la position binlog de départ à partir de l'export — le binlog est-il bien actif ?");
  }
  const [, logFile, logPos] = coordMatch;

  updateReplicationStatus(r.id, "setting_up", "Transfert de l'export vers la machine cible…");
  const dest = getHostConnectionInfo(r.targetHostId);
  const targetDumpPath = `/tmp/hlp-mysql-dump-${r.id}.sql`;
  await ensureRemoteDir(r.sourceHostId, r.targetHostId, "/tmp", keyPath);
  const sshOpts = `-i ${keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -p ${dest.port}`;
  const transferCmd = `rsync -az -e ${shellQuote(`ssh ${sshOpts}`)} ${shellQuote(dumpPath)} ${shellQuote(`${dest.user}@${dest.address}:${targetDumpPath}`)}`;
  const { code: transferCode, stderr: transferErr } = await runSshCommand(r.sourceHostId, transferCmd, { timeoutMs: SETUP_TIMEOUT_MS });
  await runSshCommand(r.sourceHostId, `rm -f ${shellQuote(dumpPath)}`);
  if (transferCode !== 0) throw new Error(transferErr || "Échec du transfert de l'export vers la machine cible.");

  updateReplicationStatus(r.id, "setting_up", "Restauration sur la machine cible…");
  const restoreCmd = `MYSQL_PWD=${shellQuote(secrets.dbPassword)} mysql -h 127.0.0.1 -P ${port} -u ${shellQuote(r.dbUser)} < ${shellQuote(targetDumpPath)}`;
  const { code: restoreCode, stderr: restoreErr } = await runSshCommand(r.targetHostId, restoreCmd, { timeoutMs: SETUP_TIMEOUT_MS });
  await runSshCommand(r.targetHostId, `rm -f ${shellQuote(targetDumpPath)}`);
  if (restoreCode !== 0) throw new Error(restoreErr || "Échec de la restauration sur la machine cible.");

  if (r.appDbUser && secrets.appDbPassword) {
    updateReplicationStatus(r.id, "setting_up", "Création de l'identifiant applicatif sur la machine cible…");
    // mysqldump --databases only ever moves the named database's own schema/data, never the grants
    // table (that lives in the separate `mysql` system database) — without this, the application's
    // real login simply wouldn't exist on B at all, only the internal replication role above.
    // Idempotent (CREATE USER IF NOT EXISTS + an unconditional ALTER for the password) so
    // reconfiguring an existing replication updates the password instead of erroring on a rerun.
    const appUserSql =
      `CREATE USER IF NOT EXISTS ${shellQuote(r.appDbUser)}@'%' IDENTIFIED BY ${shellQuote(secrets.appDbPassword)}; ` +
      `ALTER USER ${shellQuote(r.appDbUser)}@'%' IDENTIFIED BY ${shellQuote(secrets.appDbPassword)}; ` +
      `GRANT ALL PRIVILEGES ON ${shellQuote(r.sourcePath)}.* TO ${shellQuote(r.appDbUser)}@'%'; FLUSH PRIVILEGES;`;
    const { code: appUserCode, stderr: appUserErr } = await runSshCommand(
      r.targetHostId,
      `echo ${shellQuote(appUserSql)} | ${mysqlCommand("127.0.0.1", port, r.dbUser, secrets.dbPassword)}`,
      { timeoutMs: SETUP_TIMEOUT_MS }
    );
    if (appUserCode !== 0) throw new Error(appUserErr || "Impossible de créer l'identifiant applicatif sur la machine cible.");
  }

  updateReplicationStatus(r.id, "setting_up", "Démarrage de la réplication…");
  const source = getHostConnectionInfo(r.sourceHostId);
  const changeMasterSql =
    `CHANGE MASTER TO MASTER_HOST=${shellQuote(source.address)}, MASTER_PORT=${port}, ` +
    `MASTER_USER=${shellQuote(cred.user)}, MASTER_PASSWORD=${shellQuote(cred.password)}, ` +
    `MASTER_LOG_FILE=${shellQuote(logFile)}, MASTER_LOG_POS=${logPos}; START SLAVE;`;
  const { code: startCode, stderr: startErr } = await runSshCommand(
    r.targetHostId,
    `echo ${shellQuote(changeMasterSql)} | ${mysqlCommand("127.0.0.1", port, r.dbUser, secrets.dbPassword)}`,
    { timeoutMs: SETUP_TIMEOUT_MS }
  );
  if (startCode !== 0) throw new Error(startErr || "Impossible de démarrer la réplication sur la machine cible.");

  updateReplicationStatus(r.id, "in_sync", "Réplication démarrée.", true);
}

/** Parses the tab-separated single-row output of `SHOW SLAVE STATUS` run with `-B` (batch mode,
 * one line of tab-separated values with a header row) — much easier to parse reliably than the
 * default `\G` vertical format, at the cost of needing the header row to map column names to
 * positions (the column set/order is not guaranteed stable across MySQL/MariaDB versions). */
function parseSlaveStatus(output: string): Record<string, string> | null {
  const lines = output.trim().split("\n");
  if (lines.length < 2) return null;
  const headers = lines[0].split("\t");
  const values = lines[1].split("\t");
  const result: Record<string, string> = {};
  headers.forEach((h, i) => (result[h] = values[i] ?? ""));
  return result;
}

export async function checkMysqlReplicationStatus(r: Replication): Promise<void> {
  const secrets = getReplicationSecrets(r.id);
  if (!r.dbUser || !secrets.dbPassword) {
    updateReplicationStatus(r.id, "error", "Identifiants administrateur manquants pour vérifier l'état.");
    return;
  }
  const port = r.dbPort || 3306;
  const { stdout, code, stderr } = await runSshCommand(
    r.targetHostId,
    `${mysqlCommand("127.0.0.1", port, r.dbUser, secrets.dbPassword)} -B -e "SHOW SLAVE STATUS"`,
    { timeoutMs: STATUS_TIMEOUT_MS }
  );
  if (code !== 0) {
    updateReplicationStatus(r.id, "error", stderr || "Impossible d'interroger l'état de la réplication sur la machine cible.");
    return;
  }
  const status = parseSlaveStatus(stdout);
  if (!status) {
    updateReplicationStatus(r.id, "error", "Aucune réplication configurée trouvée sur la machine cible (SHOW SLAVE STATUS vide).");
    return;
  }
  const ioRunning = status["Slave_IO_Running"] === "Yes";
  const sqlRunning = status["Slave_SQL_Running"] === "Yes";
  const lag = status["Seconds_Behind_Master"];
  if (ioRunning && sqlRunning) {
    const lagText = lag && lag !== "NULL" ? `, retard : ${lag}s` : "";
    updateReplicationStatus(r.id, Number(lag) > 30 ? "lagging" : "in_sync", `Réplication active${lagText}.`, true);
  } else {
    updateReplicationStatus(
      r.id,
      "error",
      `Réplication arrêtée (IO: ${status["Slave_IO_Running"] || "?"}, SQL: ${status["Slave_SQL_Running"] || "?"})${
        status["Last_Error"] ? ` — ${status["Last_Error"]}` : ""
      }`
    );
  }
}
