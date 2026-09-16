import { randomUUID } from "crypto";
import { runSshCommand, shellQuote } from "../ssh";
import { withTimeout } from "../timeout";
import { vaultDecrypt } from "../crypto";
import type { DbConnection } from "./sqlRunner";

const DUMP_TIMEOUT_MS = 5 * 60_000;

function dumpCommand(conn: DbConnection, password: string, database: string): string {
  if (conn.engine === "mysql") {
    const cmd = `mysqldump -h ${shellQuote(conn.dbHost)} -P ${conn.dbPort} -u ${shellQuote(conn.username)} ${shellQuote(database)}`;
    return conn.containerId
      ? `docker exec -e MYSQL_PWD=${shellQuote(password)} ${shellQuote(conn.containerId)} ${cmd}`
      : `MYSQL_PWD=${shellQuote(password)} ${cmd}`;
  }
  const cmd = `pg_dump -h ${shellQuote(conn.dbHost)} -p ${conn.dbPort} -U ${shellQuote(conn.username)} -d ${shellQuote(database)}`;
  return conn.containerId
    ? `docker exec -e PGPASSWORD=${shellQuote(password)} ${shellQuote(conn.containerId)} ${cmd}`
    : `PGPASSWORD=${shellQuote(password)} ${cmd}`;
}

function restoreCommand(conn: DbConnection, password: string, database: string): string {
  if (conn.engine === "mysql") {
    const cmd = `mysql -h ${shellQuote(conn.dbHost)} -P ${conn.dbPort} -u ${shellQuote(conn.username)} ${shellQuote(database)}`;
    return conn.containerId
      ? `docker exec -i -e MYSQL_PWD=${shellQuote(password)} ${shellQuote(conn.containerId)} ${cmd}`
      : `MYSQL_PWD=${shellQuote(password)} ${cmd}`;
  }
  const cmd = `psql -h ${shellQuote(conn.dbHost)} -p ${conn.dbPort} -U ${shellQuote(conn.username)} -d ${shellQuote(database)}`;
  return conn.containerId
    ? `docker exec -i -e PGPASSWORD=${shellQuote(password)} ${shellQuote(conn.containerId)} ${cmd}`
    : `PGPASSWORD=${shellQuote(password)} ${cmd}`;
}

/** Dumps a single database to a gzip'd SQL file, entirely on the remote host, and returns it
 * base64-encoded over the same SSH exec channel used for everything else — no separate file
 * transfer step needed, at the cost of holding the whole dump in memory for a homelab-scale
 * database (acceptable; a multi-GB production dump would want the panel's real backup engine —
 * see lib/backup/sources/database.ts — with retention and streaming to disk, not this one-off
 * "download a copy right now" action). */
export async function dumpDatabaseToBase64(conn: DbConnection, database: string): Promise<{ base64: string; filename: string }> {
  const password = vaultDecrypt(conn.passwordEncrypted);
  const remoteTmp = `/tmp/homelab-panel-db-dump-${randomUUID()}.sql.gz`;
  const command = `set -o pipefail; ${dumpCommand(conn, password, database)} | gzip > ${shellQuote(remoteTmp)} && base64 -w0 ${shellQuote(remoteTmp)}; RC=$?; rm -f ${shellQuote(remoteTmp)}; exit $RC`;

  const { stdout, code, stderr } = await withTimeout(
    runSshCommand(conn.hostId, command, { sudo: true }),
    DUMP_TIMEOUT_MS,
    "Délai dépassé lors de l'export."
  );
  if (code !== 0) throw new Error(stderr.trim() || "Échec de l'export de la base.");
  return { base64: stdout.trim(), filename: `${database}-${new Date().toISOString().slice(0, 10)}.sql.gz` };
}

/** Restores from a .sql or .sql.gz file's raw bytes (already read into memory by the API route
 * from the uploaded file) by shipping it to the remote host as base64 over stdin, then piping it
 * (decompressing first if gzipped) straight into mysql/psql — the same "no separate transfer
 * step" trade-off as the dump side, sized for a homelab restore rather than a multi-GB one. */
export async function restoreDatabaseFromBase64(
  conn: DbConnection,
  database: string,
  base64Content: string,
  isGzip: boolean
): Promise<void> {
  const password = vaultDecrypt(conn.passwordEncrypted);
  const remoteTmp = `/tmp/homelab-panel-db-restore-${randomUUID()}.b64`;
  const decodeAndPipe = isGzip
    ? `base64 -d ${shellQuote(remoteTmp)} | gunzip -c | ${restoreCommand(conn, password, database)}`
    : `base64 -d ${shellQuote(remoteTmp)} | ${restoreCommand(conn, password, database)}`;

  // The base64 payload travels as its own heredoc write first (kept well under typical remote
  // ARG_MAX/pipe limits since it's chunked as stdin, not a single argv), then a second command
  // decodes and pipes it into the target CLI — splitting it this way avoids holding the decode
  // and the restore's own stdin need in the same pipeline as the upload.
  const writeCommand = `cat > ${shellQuote(remoteTmp)} <<'HLP_B64_EOF'\n${base64Content}\nHLP_B64_EOF`;
  const writeResult = await withTimeout(
    runSshCommand(conn.hostId, writeCommand, { sudo: true }),
    DUMP_TIMEOUT_MS,
    "Délai dépassé lors du transfert du fichier."
  );
  if (writeResult.code !== 0) throw new Error(writeResult.stderr.trim() || "Échec du transfert du fichier de restauration.");

  const command = `set -o pipefail; ${decodeAndPipe}; RC=$?; rm -f ${shellQuote(remoteTmp)}; exit $RC`;
  const { code, stderr } = await withTimeout(
    runSshCommand(conn.hostId, command, { sudo: true }),
    DUMP_TIMEOUT_MS,
    "Délai dépassé lors de la restauration."
  );
  if (code !== 0) throw new Error(stderr.trim() || "Échec de la restauration.");
}
