import type { Client as SshClient, ClientChannel } from "ssh2";
import { connectSsh, buildPrivilegedCommand, shellQuote } from "../ssh";
import { vaultDecrypt } from "../crypto";
import { explainMysqlError, type DbConnection } from "./sqlRunner";

/** Hard ceiling on an import's upload size — matches what the UI advertises and tells the user
 * about up front, rather than letting a huge file fail unpredictably deep into the transfer. */
export const MAX_IMPORT_BYTES = 1024 * 1024 * 1024; // 1 GiB

// No ceiling on *total* transfer time — a near-1GB dump/restore over a slow homelab link can
// legitimately take a while. Reset on every byte that actually moves instead, so only a
// connection that's gone fully silent (not just slow) gets torn down.
const IDLE_TIMEOUT_MS = 2 * 60_000;

// Same reasoning as sqlRunner.ts's MYSQL_BIN_DETECT: recent MariaDB packaging/images can lack the
// `mysql`/`mysqldump` compatibility names entirely, only shipping `mariadb`/`mariadb-dump`.
function binDetect(candidates: [string, string], notFoundMessage: string): string {
  return (
    `BIN=$(command -v ${candidates[0]} 2>/dev/null || command -v ${candidates[1]} 2>/dev/null); ` +
    `[ -n "$BIN" ] || { echo ${shellQuote(notFoundMessage)} >&2; exit 127; }`
  );
}

function dumpCommand(conn: DbConnection, password: string, database: string): string {
  if (conn.engine === "mysql") {
    // --protocol=TCP: see sqlRunner.ts's identical flag for why — without it, a host that looks
    // like "localhost" silently switches to a Unix socket instead of dbHost:dbPort.
    const args = `--protocol=TCP -h ${shellQuote(conn.dbHost)} -P ${conn.dbPort} -u ${shellQuote(conn.username)} ${shellQuote(database)}`;
    const detect = binDetect(["mysqldump", "mariadb-dump"], "Client mysqldump/mariadb-dump introuvable — installe mariadb-client.");
    if (conn.containerId) {
      const script = `${detect}; exec "$BIN" ${args}`;
      return `docker exec -e MYSQL_PWD=${shellQuote(password)} ${shellQuote(conn.containerId)} sh -c ${shellQuote(script)}`;
    }
    return `(${detect}; MYSQL_PWD=${shellQuote(password)} "$BIN" ${args})`;
  }
  const cmd = `pg_dump -h ${shellQuote(conn.dbHost)} -p ${conn.dbPort} -U ${shellQuote(conn.username)} -d ${shellQuote(database)}`;
  return conn.containerId
    ? `docker exec -e PGPASSWORD=${shellQuote(password)} ${shellQuote(conn.containerId)} ${cmd}`
    : `PGPASSWORD=${shellQuote(password)} ${cmd}`;
}

function restoreCommand(conn: DbConnection, password: string, database: string): string {
  if (conn.engine === "mysql") {
    const args = `--protocol=TCP -h ${shellQuote(conn.dbHost)} -P ${conn.dbPort} -u ${shellQuote(conn.username)} ${shellQuote(database)}`;
    const detect = binDetect(["mysql", "mariadb"], "Client mysql/mariadb introuvable — installe mariadb-client.");
    if (conn.containerId) {
      const script = `${detect}; exec "$BIN" ${args}`;
      return `docker exec -i -e MYSQL_PWD=${shellQuote(password)} ${shellQuote(conn.containerId)} sh -c ${shellQuote(script)}`;
    }
    return `(${detect}; MYSQL_PWD=${shellQuote(password)} "$BIN" ${args})`;
  }
  const cmd = `psql -h ${shellQuote(conn.dbHost)} -p ${conn.dbPort} -U ${shellQuote(conn.username)} -d ${shellQuote(database)}`;
  return conn.containerId
    ? `docker exec -i -e PGPASSWORD=${shellQuote(password)} ${shellQuote(conn.containerId)} ${cmd}`
    : `PGPASSWORD=${shellQuote(password)} ${cmd}`;
}

/** Opens the exec channel for `rawCommand`, wrapped in sudo (and fed the sudo password on stdin)
 * exactly like every other privileged command in the panel — see buildPrivilegedCommand's own
 * comment for why this is applied uniformly rather than only when strictly necessary. */
function execPrivileged(hostId: number, rawCommand: string): Promise<{ client: SshClient; channel: ClientChannel }> {
  const { command, stdinPassword } = buildPrivilegedCommand(hostId, rawCommand);
  return connectSsh(hostId).then(
    (client) =>
      new Promise((resolve, reject) => {
        client.exec(command, (err, channel) => {
          if (err) {
            client.end();
            reject(err);
            return;
          }
          if (stdinPassword) channel.write(`${stdinPassword}\n`);
          resolve({ client, channel });
        });
      })
  );
}

function safeEnd(client: SshClient) {
  try {
    client.end();
  } catch {
    // already closing
  }
}

/** Idle-reset watchdog: only fires if nothing — no stdout, no stderr, no input chunk — has moved
 * for IDLE_TIMEOUT_MS. Call `.poke()` from whichever side carries the real payload (stdout for a
 * dump, the upload's own data events for a restore). */
function armIdleWatchdog(client: SshClient, channel: ClientChannel, onTimeout: () => void) {
  let timer: NodeJS.Timeout;
  const poke = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        channel.close();
      } catch {
        // already closing
      }
      safeEnd(client);
      onTimeout();
    }, IDLE_TIMEOUT_MS);
  };
  poke();
  channel.on("data", poke);
  channel.stderr.on("data", poke);
  return { cancel: () => clearTimeout(timer), poke };
}

/**
 * Dumps a database as a gzip'd byte stream straight from the remote mysqldump/pg_dump process —
 * no remote temp file, no base64 (which, for a dump approaching 1GB, risks Node/V8's max string
 * length and adds 33% of pure overhead for nothing). The caller pipes this directly into the HTTP
 * response body instead of buffering the whole export in memory.
 */
export async function dumpDatabaseToStream(
  conn: DbConnection,
  database: string
): Promise<{ webStream: ReadableStream<Uint8Array>; filename: string }> {
  const password = vaultDecrypt(conn.passwordEncrypted);
  const command = `set -o pipefail; ${dumpCommand(conn, password, database)} | gzip`;
  const { client, channel } = await execPrivileged(conn.hostId, command);

  const webStream = new ReadableStream<Uint8Array>({
    start(controller) {
      let stderr = "";
      let settled = false;
      const watchdog = armIdleWatchdog(client, channel, () => {
        if (settled) return;
        settled = true;
        controller.error(new Error("Délai dépassé — l'export a été interrompu (connexion inactive)."));
      });
      channel.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
      channel.on("data", (chunk: Buffer) => {
        if (settled) return;
        controller.enqueue(new Uint8Array(chunk));
      });
      channel.on("close", (code: number) => {
        watchdog.cancel();
        safeEnd(client);
        if (settled) return;
        settled = true;
        if (code === 0) controller.close();
        else controller.error(new Error(conn.engine === "mysql" ? explainMysqlError(stderr) : stderr.trim() || "Échec de l'export."));
      });
      channel.on("error", (err: Error) => {
        watchdog.cancel();
        if (settled) return;
        settled = true;
        controller.error(err);
      });
    },
    cancel() {
      try {
        channel.close();
      } catch {
        // already closing
      }
      safeEnd(client);
    },
  });

  return { webStream, filename: `${database}-${new Date().toISOString().slice(0, 10)}.sql.gz` };
}

/**
 * Restores a database from the uploaded file's own raw bytes, piped straight into mysql/psql's
 * stdin over the SSH exec channel (decompressed on the remote end via `gunzip -c` first when
 * `isGzip`, never here) — the same "never hold the whole transfer as one in-memory string"
 * reasoning as the dump side above, since a ~1GB import based64-encoded client-side would also
 * double as much RAM again on the way through.
 */
export async function restoreDatabaseFromStream(
  conn: DbConnection,
  database: string,
  input: NodeJS.ReadableStream,
  isGzip: boolean
): Promise<void> {
  const password = vaultDecrypt(conn.passwordEncrypted);
  const pipeline = isGzip ? `gunzip -c | ${restoreCommand(conn, password, database)}` : restoreCommand(conn, password, database);
  const command = `set -o pipefail; ${pipeline}`;
  const { client, channel } = await execPrivileged(conn.hostId, command);

  return new Promise((resolve, reject) => {
    let stderr = "";
    let settled = false;
    const watchdog = armIdleWatchdog(client, channel, () => {
      if (settled) return;
      settled = true;
      reject(new Error("Délai dépassé — la restauration a été interrompue (connexion inactive)."));
    });
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      watchdog.cancel();
      fn();
    };

    channel.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    channel.on("close", (code: number) => {
      safeEnd(client);
      finish(() => {
        if (code === 0) resolve();
        else reject(new Error(conn.engine === "mysql" ? explainMysqlError(stderr) : stderr.trim() || "Échec de la restauration."));
      });
    });
    channel.on("error", (err: Error) => finish(() => reject(err)));

    input.on("data", watchdog.poke);
    input.on("error", (err) => {
      try {
        channel.end();
      } catch {
        // already closing
      }
      finish(() => reject(err instanceof Error ? err : new Error("Erreur de lecture du fichier.")));
    });
    input.pipe(channel);
  });
}
