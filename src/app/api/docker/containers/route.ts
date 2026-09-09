import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listContainers, type DockerContainer } from "@/lib/docker";
import { withTimeout } from "@/lib/timeout";

type DockerHost = { id: number; name: string };

export type AggregatedContainer = DockerContainer & { hostId: number; hostName: string };

const HOST_TIMEOUT_MS = 8000;

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
