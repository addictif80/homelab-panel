import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listIncusInstances, type IncusInstance } from "@/lib/incus";
import { withTimeout } from "@/lib/timeout";

type IncusHost = { id: number; name: string };

export type AggregatedInstance = IncusInstance & { hostId: number; hostName: string };

// Same reasoning as the Docker containers route: comfortably above incus.ts's own exec timeout
// (inherited from execOnHostClean/EXEC_TIMEOUT_MS, 11s) so that inner timeout force-closes the SSH
// connection before this outer one gives up, never leaving an orphaned session behind.
const HOST_TIMEOUT_MS = 12_000;

export async function GET() {
  const hosts = getDb()
    .prepare(`SELECT id, name FROM hosts WHERE incus_enabled = 1 ORDER BY name`)
    .all() as IncusHost[];

  const results = await Promise.all(
    hosts.map(async (host) => {
      try {
        const instances = await withTimeout(
          listIncusInstances(host.id),
          HOST_TIMEOUT_MS,
          `Timeout: ${host.name} n'a pas répondu.`
        );
        return {
          hostId: host.id,
          hostName: host.name,
          instances: instances.map((i) => ({ ...i, hostId: host.id, hostName: host.name })),
          error: null as string | null,
        };
      } catch (err) {
        return {
          hostId: host.id,
          hostName: host.name,
          instances: [] as AggregatedInstance[],
          error: err instanceof Error ? err.message : "Erreur Incus.",
        };
      }
    })
  );

  return NextResponse.json({
    hosts: results.map(({ hostId, hostName, error }) => ({ hostId, hostName, error })),
    instances: results.flatMap((r) => r.instances),
  });
}
