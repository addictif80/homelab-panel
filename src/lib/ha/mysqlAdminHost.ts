import { runSshCommand, shellQuote } from "../ssh";

const PROBE_TIMEOUT_MS = 10_000;

// Recent MariaDB packaging (and its official Docker images from 10.11/11.x on) dropped the `mysql`
// compatibility symlink some distros used to ship alongside `mariadb` — tried in order rather than
// assuming either name exists.
export const MYSQL_BIN_DETECT =
  'BIN=$(command -v mysql 2>/dev/null || command -v mariadb 2>/dev/null); ' +
  '[ -n "$BIN" ] || { echo "Client mysql/mariadb introuvable sur cette machine." >&2; exit 127; }';

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
 */
export async function resolveMysqlAdminHost(
  hostId: number,
  port: number,
  user: string,
  password: string,
  fallbackAddress: string
): Promise<string> {
  const { code } = await runSshCommand(
    hostId,
    `${MYSQL_BIN_DETECT}; MYSQL_PWD=${shellQuote(password)} "$BIN" --protocol=TCP -h 127.0.0.1 -P ${port} -u ${shellQuote(user)} -e "SELECT 1" >/dev/null 2>&1`,
    { timeoutMs: PROBE_TIMEOUT_MS }
  ).catch(() => ({ code: 1, stdout: "", stderr: "" }));
  return code === 0 ? "127.0.0.1" : fallbackAddress;
}
