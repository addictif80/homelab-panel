import { runSshCommand, shellQuote } from "../ssh";

const PROBE_TIMEOUT_MS = 10_000;

// Recent MariaDB packaging (and its official Docker images from 10.11/11.x on) dropped the `mysql`
// compatibility symlink some distros used to ship alongside `mariadb` — tried in order rather than
// assuming either name exists.
export const MYSQL_BIN_DETECT =
  'BIN=$(command -v mysql 2>/dev/null || command -v mariadb 2>/dev/null); ' +
  '[ -n "$BIN" ] || { echo "Client mysql/mariadb introuvable sur cette machine." >&2; exit 127; }';

async function probe(hostId: number, host: string, port: number, user: string, password: string): Promise<boolean> {
  const { code } = await runSshCommand(
    hostId,
    `${MYSQL_BIN_DETECT}; MYSQL_PWD=${shellQuote(password)} "$BIN" --protocol=TCP -h ${shellQuote(host)} -P ${port} -u ${shellQuote(user)} -e "SELECT 1" >/dev/null 2>&1`,
    { timeoutMs: PROBE_TIMEOUT_MS }
  ).catch(() => ({ code: 1, stdout: "", stderr: "" }));
  return code === 0;
}

/**
 * Figures out which host string actually lets an admin SQL command (list databases, create a
 * grant, dump/restore) reach this machine's own MariaDB/MySQL — tried over the very same SSH
 * session already running on that machine. Loopback is tried first: it needs no network exposure
 * at all and just works whenever bind-address is left at its common 127.0.0.1-only default (the
 * out-of-the-box config on most distro packages, CyberPanel included). The host's own real address
 * (Tailscale/LAN IP) is the fallback, for the opposite case — an install where the connecting
 * account only has a `'user'@'localhost'` grant using the unix_socket auth plugin (the default for
 * root on the official Docker images), which rejects a password outright over loopback/socket but
 * matches a real `'user'@'%'` grant instead over a genuine network connection.
 *
 * This only helps *admin* commands run locally on the machine that owns the data — it cannot help
 * the live replication stream itself (`CHANGE MASTER TO MASTER_HOST=...`), which is a *different*
 * machine dialing in continuously and therefore always needs a real, reachable network address on
 * the source, loopback or not.
 *
 * Used by one-shot, user-initiated actions (setup, reverse sync, listing databases) where, if
 * neither address actually works, whatever real command runs next against the returned fallback
 * will fail on its own and surface that failure directly — acceptable there since a human is
 * watching. The background status check uses resolveMysqlAdminHostOrUnreachable instead, which
 * tells the two failure modes apart up front (see its own doc comment for why that distinction
 * matters for that caller specifically).
 */
export async function resolveMysqlAdminHost(
  hostId: number,
  port: number,
  user: string,
  password: string,
  fallbackAddress: string
): Promise<string> {
  return (await probe(hostId, "127.0.0.1", port, user, password)) ? "127.0.0.1" : fallbackAddress;
}

export type MysqlAdminHostResult = { reachable: true; host: string } | { reachable: false };

/**
 * Same probing as resolveMysqlAdminHost, but for a caller that needs to tell apart "found a
 * working admin host" from "neither loopback nor the network address accepted a connection right
 * now". That second case doesn't mean the *network address* is unreachable — on a native install
 * (bind-address left at its loopback-only default, e.g. CyberPanel), the fallback address was
 * never going to answer anyway, whether the server is healthy or not. It actually means the server
 * itself isn't accepting any connections at all: still starting up, mid crash-recovery after an
 * unclean shutdown, or genuinely down — worth saying plainly instead of reporting a connection
 * failure against whichever address happened to be tried last, which reads as a network problem
 * that isn't the real cause (see the background status check that uses this).
 */
export async function resolveMysqlAdminHostOrUnreachable(
  hostId: number,
  port: number,
  user: string,
  password: string,
  fallbackAddress: string
): Promise<MysqlAdminHostResult> {
  if (await probe(hostId, "127.0.0.1", port, user, password)) return { reachable: true, host: "127.0.0.1" };
  if (await probe(hostId, fallbackAddress, port, user, password)) return { reachable: true, host: fallbackAddress };
  return { reachable: false };
}
