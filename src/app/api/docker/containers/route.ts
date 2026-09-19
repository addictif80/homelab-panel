import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listContainers, type DockerContainer } from "@/lib/docker";
import { withTimeout } from "@/lib/timeout";

type DockerHost = { id: number; name: string };

export type AggregatedContainer = DockerContainer & { hostId: number; hostName: string };

// A NAS-class host with `needs_sudo` (the default for every new host) pays for a login-shell
// profile chain on top of the sudo prompt itself on every single call — 8s was tight enough to
// misreport a merely-slow host as unreachable. 12s gives that room while still keeping one bad
// host from stalling the fleet view for long; docker.ts's own EXEC_TIMEOUT_MS (11s) force-closes
// the underlying SSH connection just before this fires, so a timeout here never leaves an orphaned
// session behind.
const HOST_TIMEOUT_MS = 12_000;

export async function GET() {
  const hosts = getDb()
    .prepare(`SELECT id, name FROM hosts WHERE docker_enabled = 1 ORDER BY name`)
    .all() as DockerHost[];

  const results = await Promise.all(
    hosts.map(async (host) => {
      try {
        const containers = await withTimeout(
          listContainers(host.id),
          HOST_TIMEOUT_MS,
          `Timeout: ${host.name} n'a pas répondu.`
        );
        return {
          hostId: host.id,
          hostName: host.name,
          containers: containers.map((c) => ({ ...c, hostId: host.id, hostName: host.name })),
          error: null as string | null,
        };
      } catch (err) {
        return {
          hostId: host.id,
          hostName: host.name,
          containers: [] as AggregatedContainer[],
          error: err instanceof Error ? err.message : "Erreur Docker.",
        };
      }
    })
  );

  return NextResponse.json({
    hosts: results.map(({ hostId, hostName, error }) => ({ hostId, hostName, error })),
    containers: results.flatMap((r) => r.containers),
  });
}
