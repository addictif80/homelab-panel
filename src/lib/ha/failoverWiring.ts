import { getDb } from "../db";
import { getProxyHost } from "../npm";
import { applyFailover } from "../npmFailover";
import type { Replication } from "./replication";

type TargetHostRow = { tailscale_ip: string | null; lan_ip: string | null; public_ip: string | null };

/** Same address preference as lib/ssh.ts's resolveHostAddress — Tailscale first, since the whole
 * point here is a target machine that is deliberately not exposed publicly and only reachable over
 * the tailnet (or, failing that, the LAN). */
function resolveTargetAddress(hostId: number): string | null {
  const row = getDb().prepare(`SELECT tailscale_ip, lan_ip, public_ip FROM hosts WHERE id = ?`).get(hostId) as
    | TargetHostRow
    | undefined;
  return row?.tailscale_ip || row?.lan_ip || row?.public_ip || null;
}

/**
 * Pushes this replication's target host straight into its linked NPM proxy host's existing
 * failover config as the backup server (lib/npmFailover.ts already does the actual nginx-level
 * `error_page`+fallback work — this only fills in *what* to fail over to). A no-op when the
 * replication has no `proxyHostId` set — attaching one is optional, since not every replication
 * backs a web-facing service that goes through NPM.
 */
export async function wireFailoverForReplication(r: Replication): Promise<void> {
  if (!r.proxyHostId) return;

  const address = resolveTargetAddress(r.targetHostId);
  if (!address) {
    throw new Error(
      "La machine cible n'a aucune adresse IP renseignée (Tailscale, LAN ou publique) — impossible de la brancher comme secours NPM."
    );
  }

  const proxyHost = await getProxyHost(r.proxyHostId);
  await applyFailover(r.proxyHostId, {
    mode: "server",
    scheme: proxyHost.forwardScheme,
    host: address,
    port: r.targetPort || proxyHost.forwardPort,
  });
}
