import { runSshCommand, shellQuote } from "../ssh";
import { withTimeout } from "../timeout";
import { vaultDecrypt } from "../crypto";
import { getDb } from "../db";

export type Engine = "mysql" | "postgres";

export type DbConnection = {
  id: string;
  hostId: number;
  label: string;
  engine: Engine;
  containerId: string | null;
  dbHost: string;
  dbPort: number;
  username: string;
  passwordEncrypted: string;
};

type DbConnectionRow = {
  id: string;
  host_id: number;
  label: string;
  engine: Engine;
  container_id: string | null;
  db_host: string;
  db_port: number;
  username: string;
  password_encrypted: string;
};

function rowToConnection(row: DbConnectionRow): DbConnection {
  return {
    id: row.id,
    hostId: row.host_id,
    label: row.label,
    engine: row.engine,
    containerId: row.container_id,
    dbHost: row.db_host,
    dbPort: row.db_port,
    username: row.username,
    passwordEncrypted: row.password_encrypted,
  };
}

export function getDbConnection(id: string): DbConnection {
  const row = getDb().prepare(`SELECT * FROM db_connections WHERE id = ?`).get(id) as DbConnectionRow | undefined;
  if (!row) throw new Error("Connexion introuvable.");
  return rowToConnection(row);
}

/** Postgres-only: a distinctive marker so a genuine NULL can be told apart from an empty string
 * in the unaligned tab-separated output — MySQL has no equivalent option and always prints the
 * literal text "NULL" for a null cell, which is an accepted, documented imprecision (a real string
 * that happens to read "NULL" is indistinguishable) rather than something worth a native driver for. */
const PG_NULL_MARKER = "¤HLP_NULL¤";

/** Recent MariaDB packaging (and its official Docker images from 10.11/11.x on) dropped the
 * `mysql` compatibility symlink some distros used to ship alongside `mariadb` — a host or
 * container with only the MariaDB client actually installed then has no `mysql` binary at all,
 * which previously surfaced as a bare "mysql: command not found" instead of a usable connection
 * test. Tries both names at the point of use rather than assuming one. */
const MYSQL_BIN_DETECT =
  'BIN=$(command -v mysql 2>/dev/null || command -v mariadb 2>/dev/null); ' +
  '[ -n "$BIN" ] || { echo "Client mysql/mariadb introuvable — installe-le avec : apt-get install -y mariadb-client (ou mysql-client)." >&2; exit 127; }';

/** Wraps the mysql/psql CLI invocation for a connection, through `docker exec` first when the
 * database runs in a container rather than natively on the host. The password never appears as a
 * CLI argument (visible to any other user on the box via `ps`) — it's exported as an env var
 * scoped to this one command instead, via a `docker exec -e` flag or a plain shell prefix. */
function buildCommandPrefix(conn: DbConnection, password: string, database?: string): string {
  if (conn.engine === "mysql") {
    const args = [
      // Without this, the mysql/mariadb client silently switches to a local Unix socket whenever
      // the host looks like "localhost" (a long-standing client quirk, independent of the port
      // given) — which then authenticates as 'root'@'localhost' instead of going over TCP to
      // dbPort at all. On the official MariaDB image, that socket-side root account often has
      // different grants/plugin than the TCP-side 'root'@'%' the panel actually configured,
      // surfacing as a confusing "Access denied ... using password: YES" even with the right
      // password. Forcing TCP makes the connection always go where dbHost:dbPort actually points.
      "--protocol=TCP",
      `-h ${shellQuote(conn.dbHost)}`,
      `-P ${conn.dbPort}`,
      `-u ${shellQuote(conn.username)}`,
      database ? shellQuote(database) : "",
      "--batch --raw",
    ]
      .filter(Boolean)
      .join(" ");
    if (conn.containerId) {
      const script = `${MYSQL_BIN_DETECT}; exec "$BIN" ${args}`;
      return `docker exec -e MYSQL_PWD=${shellQuote(password)} -i ${shellQuote(conn.containerId)} sh -c ${shellQuote(script)}`;
    }
    return `${MYSQL_BIN_DETECT}; MYSQL_PWD=${shellQuote(password)} "$BIN" ${args}`;
  }

  const args = [
    "psql",
    `-h ${shellQuote(conn.dbHost)}`,
    `-p ${conn.dbPort}`,
    `-U ${shellQuote(conn.username)}`,
    database ? `-d ${shellQuote(database)}` : "-d postgres",
    "-X -A",
    `-F ${shellQuote("\t")}`,
    "-P footer=off",
    `-P null=${shellQuote(PG_NULL_MARKER)}`,
  ].join(" ");
  return conn.containerId
    ? `docker exec -e PGPASSWORD=${shellQuote(password)} -i ${shellQuote(conn.containerId)} ${args}`
    : `PGPASSWORD=${shellQuote(password)} ${args}`;
}

export type QueryResult = { columns: string[]; rows: (string | null)[][]; rowCount: number };

const QUERY_TIMEOUT_MS = 30_000;

/**
 * Runs one SQL string against a connection (optionally scoped to a specific database) and parses
 * whatever tabular output the CLI produced. Works for both a SELECT (real rows) and DDL/DML
 * (mysql/psql print nothing tabular for those — an empty result is normal, not an error) as long
 * as it exits 0; a non-zero exit surfaces the CLI's own error text, which for both mysql and psql
 * is the actual SQL error message a user needs to see.
 */
export async function runSql(conn: DbConnection, sql: string, database?: string): Promise<QueryResult> {
  const password = vaultDecrypt(conn.passwordEncrypted);
  const prefix = buildCommandPrefix(conn, password, database);
  // The query travels via stdin (heredoc) rather than a `-e`/`-c` argument — arbitrarily long SQL
  // (a pasted schema migration, a bulk INSERT) has no length limit that way, and it sidesteps any
  // quoting edge case in the SQL text itself interacting with the outer shell.
  const command = `${prefix} <<'HLP_SQL_EOF'\n${sql}\nHLP_SQL_EOF`;

  const { stdout, stderr, code } = await withTimeout(
    runSshCommand(conn.hostId, command, { sudo: true }),
    QUERY_TIMEOUT_MS,
    "Délai dépassé lors de l'exécution de la requête."
  );
  if (code !== 0) throw new Error(stderr.trim() || "Échec de la requête.");

  const lines = stdout.split("\n").filter((l, i, arr) => !(i === arr.length - 1 && l === ""));
  if (lines.length === 0) return { columns: [], rows: [], rowCount: 0 };

  const columns = lines[0].split("\t");
  const rows = lines.slice(1).map((line) =>
    line.split("\t").map((cell) => {
      if (conn.engine === "postgres") return cell === PG_NULL_MARKER ? null : cell;
      return cell === "NULL" ? null : cell;
    })
  );
  return { columns, rows, rowCount: rows.length };
}

export function quoteIdentifier(engine: Engine, name: string): string {
  if (engine === "mysql") return `\`${name.replace(/`/g, "``")}\``;
  return `"${name.replace(/"/g, '""')}"`;
}

export function quoteLiteral(engine: Engine, value: string): string {
  if (engine === "mysql") return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  return `'${value.replace(/'/g, "''")}'`;
}
