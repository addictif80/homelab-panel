import { NextRequest, NextResponse } from "next/server";
import { runSshCommand, shellQuote, getHostConnectionInfo } from "@/lib/ssh";
import { explainMysqlError } from "@/lib/dbManager/sqlRunner";
import { resolveMysqlAdminHost, MYSQL_BIN_DETECT } from "@/lib/ha/mysqlAdminHost";

const TIMEOUT_MS = 15_000;
const SYSTEM_DATABASES = new Set(["information_schema", "mysql", "performance_schema", "sys"]);

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
  const { address } = getHostConnectionInfo(body.hostId);
  // Loopback first — needs no network exposure at all and works whenever bind-address is left at
  // its common 127.0.0.1-only default (CyberPanel and most distro packages out of the box). Falls
  // back to the host's own real address only for the opposite case, an install where the account
  // only has a unix_socket-plugin `'user'@'localhost'` grant — see mysqlAdminHost.ts.
  const host = await resolveMysqlAdminHost(body.hostId, port, body.dbUser.trim(), body.dbPassword, address);

  const command =
    `${MYSQL_BIN_DETECT}; MYSQL_PWD=${shellQuote(body.dbPassword)} "$BIN" --protocol=TCP -h ${shellQuote(host)} -P ${port} ` +
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
