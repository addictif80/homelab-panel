import { runSshCommand, getHostConnectionInfo, shellQuote } from "../ssh";
import { ensurePrivateKeyDeployed, ensurePublicKeyAuthorized } from "../backup/keys";
import { ensureRemoteDir, ensureRsyncReachable } from "../backup/transfer";
import { restartService } from "../hostCompat";
import {
  generateReplicationCredential,
  setReplicationCredential,
  getReplicationSecrets,
  updateReplicationStatus,
  resolveTargetCredential,
  type Replication,
} from "./replication";

/** `sourcePath` doubles as a list of database names for this engine (a single native replication
 * stream naturally carries several databases — MariaDB just needs one `binlog_do_db` line per
 * name) — split on comma/whitespace so "ma_base" and "ma_base, autre_base" both work from the same
 * plain text field the UI already has. */
function parseDatabaseNames(sourcePath: string): string[] {
  return sourcePath
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const SETUP_TIMEOUT_MS = 5 * 60_000;
const STATUS_TIMEOUT_MS = 15_000;

/** Debian/Ubuntu's MariaDB and MySQL packages (and the official Docker images, internally built the
 * same way) each ship their own conf.d directory (only one of which exists on a given host,
 * depending which engine is actually installed) — tried in order rather than assumed, since
 * guessing wrong means writing a config file nothing ever reads. Routed through `docker exec` when
 * `container` is set, so this works the same whether MariaDB is native or containerized. */
async function findMysqlConfDir(hostId: number, container: string | null): Promise<string> {
  const candidates = ["/etc/mysql/mariadb.conf.d", "/etc/mysql/mysql.conf.d", "/etc/mysql/conf.d"];
  for (const dir of candidates) {
    const testCmd = container ? `docker exec ${shellQuote(container)} test -d ${shellQuote(dir)}` : `test -d ${shellQuote(dir)}`;
    const { code } = await runSshCommand(hostId, testCmd, { timeoutMs: STATUS_TIMEOUT_MS, sudo: !!container });
    if (code === 0) return dir;
  }
  throw new Error(
    `Impossible de trouver le dossier de configuration MySQL/MariaDB (/etc/mysql/*.conf.d) ${
      container ? `dans le container "${container}"` : "sur cette machine"
    } — l'installation ne correspond pas au paquet Debian/Ubuntu standard (ou à l'image Docker officielle).`
  );
}

/** Restarts the MySQL/MariaDB process so a config file just written actually takes effect — a
 * `docker restart` when containerized (the config change already persists in the container's own
 * writable layer, no volume/recreate needed), otherwise tries both the `mariadb` and `mysql`
 * service names across systemd/OpenRC/SysV (see hostCompat.ts) rather than assuming either the
 * name or the init system. */
async function restartMysqlService(hostId: number, container: string | null): Promise<void> {
  if (container) {
    const { code, stderr } = await runSshCommand(hostId, `docker restart ${shellQuote(container)}`, {
      sudo: true,
      timeoutMs: SETUP_TIMEOUT_MS,
    });
    if (code !== 0) throw new Error(stderr || `Impossible de redémarrer le container "${container}".`);
    return;
  }
  const mariadb = await restartService(hostId, "mariadb");
  if (mariadb.code === 0) return;
  const mysql = await restartService(hostId, "mysql");
  if (mysql.code !== 0) {
    throw new Error(mysql.stderr || mariadb.stderr || "Impossible de redémarrer le service MySQL/MariaDB sur cette machine.");
  }
}

function mysqlCommand(host: string, port: number, user: string, password: string): string {
  return `MYSQL_PWD=${shellQuote(password)} mysql -h ${shellQuote(host)} -P ${port} -u ${shellQuote(user)}`;
}

/** Same as mysqlCommand, but routed through `docker exec` into `container` instead of a direct
 * network connection when that machine's MariaDB only exists inside a Docker container (no
 * mysql/mariadb client on the host's own shell) — used for both the source and the target, since
 * either end can independently be native or containerized. The container's own mysqld is what
 * actually dials out over the network for replication — this only changes how the setup/admin SQL
 * commands themselves are issued, since they still run over SSH on that host, just piped into the
 * container rather than into a native client. */
function resolvedMysqlCommand(container: string | null, address: string, port: number, user: string, password: string): string {
  if (container) {
    return `docker exec -i -e ${shellQuote(`MYSQL_PWD=${password}`)} ${shellQuote(container)} mysql -u ${shellQuote(user)}`;
  }
  return mysqlCommand(address, port, user, password);
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
    throw new Error("Identifiant/mot de passe administrateur MySQL requis pour la machine source pour configurer la réplication.");
  }
  const targetCred = resolveTargetCredential(r, secrets);
  if (!targetCred.user || !targetCred.password) {
    throw new Error("Identifiant/mot de passe administrateur MySQL requis pour la machine cible (ou laisse ces champs vides pour réutiliser ceux de la source).");
  }
  const databases = parseDatabaseNames(r.sourcePath);
  if (databases.length === 0) {
    throw new Error("Au moins un nom de base de données est requis.");
  }
  const port = r.dbPort || 3306;
  const cred = generateReplicationCredential("hlp_repl");
  setReplicationCredential(r.id, cred.user, cred.password);

  // Admin queries below connect to each machine's own real address (its Tailscale/LAN IP) rather
  // than 127.0.0.1/localhost, even though the command already runs on that same machine over SSH —
  // "-h localhost" makes the mysql/mariadb client silently switch to a Unix socket (a client quirk,
  // independent of --protocol=TCP), and the *server* then very often matches that socket connection
  // to a `'user'@'localhost'` grant using the unix_socket auth plugin (the default for root on the
  // official images/most distro packages), which rejects any password outright — a genuine network
  // connection to the host's own address avoids that account entirely and matches whatever
  // `'user'@'%'` (or `'user'@'<address>'`) grant actually has a real password, the same one already
  // confirmed working through the DB manager module.
  const source = getHostConnectionInfo(r.sourceHostId);
  const target = getHostConnectionInfo(r.targetHostId);

  updateReplicationStatus(r.id, "setting_up", "Déploiement de la clé SSH dédiée…");
  const keyPath = await ensurePrivateKeyDeployed(r.sourceHostId);
  await ensurePublicKeyAuthorized(r.targetHostId);
  await ensureRsyncReachable(r.sourceHostId, r.targetHostId, keyPath);

  updateReplicationStatus(r.id, "setting_up", "Activation du binlog sur la machine source…");
  const confDir = await findMysqlConfDir(r.sourceHostId, r.sourceDbContainer);
  // server-id must be unique among every server in the replication topology — derived from the
  // host id (offset to stay clear of MySQL's reserved id 0) rather than hardcoded, so two
  // replications from different source hosts never collide.
  const serverId = 1000 + r.sourceHostId;
  const binlogDoDbLines = databases.map((db) => `binlog_do_db = ${db}`).join("\n");
  const binlogConf = `[mariadb]\nserver-id = ${serverId}\nlog_bin = /var/log/mysql/mysql-bin.log\n${binlogDoDbLines}\n`;
  const confPath = `${confDir}/99-homelab-panel-ha.cnf`;
  const writeConf = r.sourceDbContainer
    ? `docker exec -i ${shellQuote(r.sourceDbContainer)} sh -c ${shellQuote(`cat > ${confPath}`)} <<'HLP_MYSQL_CONF_EOF'\n${binlogConf}\nHLP_MYSQL_CONF_EOF`
    : `cat > ${confPath} <<'HLP_MYSQL_CONF_EOF'\n${binlogConf}\nHLP_MYSQL_CONF_EOF`;
  const { code: writeConfCode, stderr: writeConfErr } = await runSshCommand(r.sourceHostId, writeConf, {
    sudo: true,
    timeoutMs: SETUP_TIMEOUT_MS,
  });
  if (writeConfCode !== 0) throw new Error(writeConfErr || "Impossible d'écrire la configuration de réplication MySQL sur la machine source.");
  await restartMysqlService(r.sourceHostId, r.sourceDbContainer);

  updateReplicationStatus(r.id, "setting_up", "Création du rôle de réplication…");
  const grantSql = `CREATE USER IF NOT EXISTS ${shellQuote(cred.user)}@'%' IDENTIFIED BY ${shellQuote(cred.password)}; GRANT REPLICATION SLAVE ON *.* TO ${shellQuote(cred.user)}@'%'; FLUSH PRIVILEGES;`;
  const { code: grantCode, stderr: grantErr } = await runSshCommand(
    r.sourceHostId,
    `echo ${shellQuote(grantSql)} | ${resolvedMysqlCommand(r.sourceDbContainer, source.address, port, r.dbUser, secrets.dbPassword)}`,
    { timeoutMs: SETUP_TIMEOUT_MS, sudo: !!r.sourceDbContainer }
  );
  if (grantCode !== 0) throw new Error(grantErr || "Impossible de créer le rôle de réplication MySQL.");

  updateReplicationStatus(r.id, "setting_up", `Export initial de ${databases.length > 1 ? "des bases" : "la base"}…`);
  const dumpPath = `/tmp/hlp-mysql-dump-${r.id}.sql`;
  const dbArgs = databases.map((db) => shellQuote(db)).join(" ");
  // --databases (rather than naming the db positionally) is what makes mysqldump prepend a
  // `CREATE DATABASE IF NOT EXISTS` for each one — the target database(s) get created automatically
  // on restore even if they don't exist yet there, no separate step needed. Routed through
  // `docker exec` on the source too when containerized — mysqldump ships in the same image as
  // mysql/mariadb, and its output is redirected to a host-side file either way since `>` here runs
  // in the outer SSH shell, not inside the container.
  const dumpCmd = r.sourceDbContainer
    ? `docker exec -i -e ${shellQuote(`MYSQL_PWD=${secrets.dbPassword}`)} ${shellQuote(r.sourceDbContainer)} mysqldump -u ${shellQuote(r.dbUser)} --single-transaction --master-data=2 --databases ${dbArgs} > ${shellQuote(dumpPath)}`
    : `MYSQL_PWD=${shellQuote(secrets.dbPassword)} mysqldump -h ${shellQuote(source.address)} -P ${port} -u ${shellQuote(r.dbUser)} --single-transaction --master-data=2 --databases ${dbArgs} > ${shellQuote(dumpPath)}`;
  const { code: dumpCode, stderr: dumpErr } = await runSshCommand(r.sourceHostId, dumpCmd, {
    timeoutMs: SETUP_TIMEOUT_MS,
    sudo: !!r.sourceDbContainer,
  });
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
  const targetDumpPath = `/tmp/hlp-mysql-dump-${r.id}.sql`;
  await ensureRemoteDir(r.sourceHostId, r.targetHostId, "/tmp", keyPath);
  const sshOpts = `-i ${keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -p ${target.port}`;
  const transferCmd = `rsync -az -e ${shellQuote(`ssh ${sshOpts}`)} ${shellQuote(dumpPath)} ${shellQuote(`${target.user}@${target.address}:${targetDumpPath}`)}`;
  const { code: transferCode, stderr: transferErr } = await runSshCommand(r.sourceHostId, transferCmd, { timeoutMs: SETUP_TIMEOUT_MS });
  await runSshCommand(r.sourceHostId, `rm -f ${shellQuote(dumpPath)}`);
  if (transferCode !== 0) throw new Error(transferErr || "Échec du transfert de l'export vers la machine cible.");

  updateReplicationStatus(r.id, "setting_up", "Restauration sur la machine cible…");
  const restoreCmd = `${resolvedMysqlCommand(r.targetDbContainer, target.address, port, targetCred.user, targetCred.password)} < ${shellQuote(targetDumpPath)}`;
  const { code: restoreCode, stderr: restoreErr } = await runSshCommand(r.targetHostId, restoreCmd, {
    timeoutMs: SETUP_TIMEOUT_MS,
    sudo: !!r.targetDbContainer,
  });
  await runSshCommand(r.targetHostId, `rm -f ${shellQuote(targetDumpPath)}`);
  if (restoreCode !== 0) throw new Error(restoreErr || "Échec de la restauration sur la machine cible.");

  if (r.appDbUser && secrets.appDbPassword) {
    updateReplicationStatus(r.id, "setting_up", "Création de l'identifiant applicatif sur la machine cible…");
    // mysqldump --databases only ever moves the named database's own schema/data, never the grants
    // table (that lives in the separate `mysql` system database) — without this, the application's
    // real login simply wouldn't exist on B at all, only the internal replication role above.
    // Idempotent (CREATE USER IF NOT EXISTS + an unconditional ALTER for the password) so
    // reconfiguring an existing replication updates the password instead of erroring on a rerun.
    // One GRANT per database — MySQL's grant syntax has no wildcard/list form for naming several
    // specific databases at once.
    const grantLines = databases.map((db) => `GRANT ALL PRIVILEGES ON ${shellQuote(db)}.* TO ${shellQuote(r.appDbUser!)}@'%';`).join(" ");
    const appUserSql =
      `CREATE USER IF NOT EXISTS ${shellQuote(r.appDbUser)}@'%' IDENTIFIED BY ${shellQuote(secrets.appDbPassword)}; ` +
      `ALTER USER ${shellQuote(r.appDbUser)}@'%' IDENTIFIED BY ${shellQuote(secrets.appDbPassword)}; ` +
      `${grantLines} FLUSH PRIVILEGES;`;
    const { code: appUserCode, stderr: appUserErr } = await runSshCommand(
      r.targetHostId,
      `echo ${shellQuote(appUserSql)} | ${resolvedMysqlCommand(r.targetDbContainer, target.address, port, targetCred.user, targetCred.password)}`,
      { timeoutMs: SETUP_TIMEOUT_MS, sudo: !!r.targetDbContainer }
    );
    if (appUserCode !== 0) throw new Error(appUserErr || "Impossible de créer l'identifiant applicatif sur la machine cible.");
  }

  updateReplicationStatus(r.id, "setting_up", "Démarrage de la réplication…");
  const changeMasterSql =
    `CHANGE MASTER TO MASTER_HOST=${shellQuote(source.address)}, MASTER_PORT=${port}, ` +
    `MASTER_USER=${shellQuote(cred.user)}, MASTER_PASSWORD=${shellQuote(cred.password)}, ` +
    `MASTER_LOG_FILE=${shellQuote(logFile)}, MASTER_LOG_POS=${logPos}; START SLAVE;`;
  const { code: startCode, stderr: startErr } = await runSshCommand(
    r.targetHostId,
    `echo ${shellQuote(changeMasterSql)} | ${resolvedMysqlCommand(r.targetDbContainer, target.address, port, targetCred.user, targetCred.password)}`,
    { timeoutMs: SETUP_TIMEOUT_MS, sudo: !!r.targetDbContainer }
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
  const targetCred = resolveTargetCredential(r, secrets);
  if (!targetCred.user || !targetCred.password) {
    updateReplicationStatus(r.id, "error", "Identifiants administrateur manquants pour vérifier l'état.");
    return;
  }
  const port = r.dbPort || 3306;
  const target = getHostConnectionInfo(r.targetHostId);
  const { stdout, code, stderr } = await runSshCommand(
    r.targetHostId,
    `${resolvedMysqlCommand(r.targetDbContainer, target.address, port, targetCred.user, targetCred.password)} -B -e "SHOW SLAVE STATUS"`,
    { timeoutMs: STATUS_TIMEOUT_MS, sudo: !!r.targetDbContainer }
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
