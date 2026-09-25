import { NextRequest, NextResponse } from "next/server";
import { runSshCommand, shellQuote, getHostConnectionInfo } from "@/lib/ssh";
import { explainMysqlError } from "@/lib/dbManager/sqlRunner";

const TIMEOUT_MS = 15_000;
const SYSTEM_DATABASES = new Set(["information_schema", "mysql", "performance_schema", "sys"]);

// Same fallback as sqlRunner.ts's MYSQL_BIN_DETECT — recent MariaDB packaging can lack the `mysql`
// compatibility name entirely.
const MYSQL_BIN_DETECT =
  'BIN=$(command -v mysql 2>/dev/null || command -v mariadb 2>/dev/null); ' +
  '[ -n "$BIN" ] || { echo "Client mysql/mariadb introuvable sur cette machine." >&2; exit 127; }';

/** Lists the real (non-system) databases on a host, using admin credentials the caller has typed
 * into the HA replication form but not necessarily saved yet — this is what powers that form's
 * database picker, so it deliberately doesn't require an existing db_connections row the way the
 * DB manager's own listing does. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    hostId?: number;
    port?: number;
    dbUser?: string;
    dbPassword?: string;
  };
  if (!body.hostId || !body.dbUser?.trim() || !body.dbPassword) {
    return NextResponse.json({ error: "Machine, utilisateur et mot de passe requis." }, { status: 400 });
  }
  const port = body.port || 3306;
  // Connects to the host's own real address rather than 127.0.0.1/localhost — see the identical
  // reasoning in mysqlReplication.ts (the "-h localhost" client quirk + root's unix_socket-plugin
  // grant on most distros/images, which rejects a password over a loopback/socket connection even
  // when it's correct — a real network connection matches the '%'-scoped grant instead, the one
  // already confirmed working through the DB manager module).
  const { address } = getHostConnectionInfo(body.hostId);

  const command =
    `${MYSQL_BIN_DETECT}; MYSQL_PWD=${shellQuote(body.dbPassword)} "$BIN" --protocol=TCP -h ${shellQuote(address)} -P ${port} ` +
    `-u ${shellQuote(body.dbUser.trim())} --batch --raw -e ${shellQuote("SHOW DATABASES;")}`;

  const { stdout, code, stderr } = await runSshCommand(body.hostId, command, { timeoutMs: TIMEOUT_MS });
  if (code !== 0) {
    return NextResponse.json(
      { error: stderr.trim() ? explainMysqlError(stderr) : "Impossible de lister les bases sur cette machine." },
      { status: 400 }
    );
  }

  const databases = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && l !== "Database" && !SYSTEM_DATABASES.has(l));
  return NextResponse.json({ databases });
}
