import { getDb } from "./db";
import { runSshCommand } from "./ssh";
import { withTimeout } from "./timeout";
import { isValidIpv4 } from "./validators";

const DETECT_TIMEOUT_MS = 10_000;

type DetectableHost = { id: number; kind: string };

/**
 * Router-kind hosts already get their public_ip auto-written from the box's own WAN status (see
 * routers/[hostId]/status) — that's the router's own outbound IP, not necessarily what a physical
 * server/VPS/NAS behind or alongside it exits with. This covers everything else that has SSH
 * access: each host asks a public echo service what IP it's seen as, over its own connection,
 * which correctly gives a VPS its own distinct public IP rather than the home router's.
 */
function getDetectableHosts(): DetectableHost[] {
  return getDb()
    .prepare(
      `SELECT h.id, h.kind FROM hosts h
       WHERE h.kind != 'router'
         AND EXISTS (SELECT 1 FROM credentials c WHERE c.host_id = h.id AND c.kind IN ('ssh_key', 'ssh_password'))`
    )
    .all() as DetectableHost[];
}

async function detectOne(hostId: number): Promise<string | null> {
  try {
    const { code, stdout } = await withTimeout(
      runSshCommand(hostId, "curl -s -4 -m 5 https://api.ipify.org || wget -qO- -T 5 https://api.ipify.org"),
      DETECT_TIMEOUT_MS,
      "Délai dépassé."
    );
    const ip = stdout.trim();
    return code === 0 && isValidIpv4(ip) ? ip : null;
  } catch {
    return null;
  }
}

/** Detects and stores the public IP for every SSH-reachable non-router host. Best-effort and
 * silent per host — a machine that's off, has no internet route, or lacks curl/wget just keeps
 * its last known value (or stays empty) rather than blocking the others. */
export async function detectAllHostPublicIps(): Promise<void> {
  const hosts = getDetectableHosts();
  const db = getDb();
  const update = db.prepare(`UPDATE hosts SET public_ip = ? WHERE id = ? AND public_ip IS NOT ?`);

  await Promise.all(
    hosts.map(async (host) => {
      const ip = await detectOne(host.id);
      if (ip) update.run(ip, host.id, ip);
    })
  );
}
