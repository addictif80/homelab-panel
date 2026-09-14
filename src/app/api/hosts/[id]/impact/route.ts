import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listContainers } from "@/lib/docker";

type HostRow = { id: number; name: string; kind: string; docker_enabled: number };

/**
 * "What breaks if I restart/shut down this machine" — read before the confirm dialog on a
 * destructive host action, so the classic homelab mistake ("j'ai éteint la mauvaise VM et j'ai
 * coupé le Wi-Fi de toute la maison") shows up before the click instead of after. Built entirely
 * from data already in the inventory (child VMs/LXCs via parent_host_id, topology via
 * network_links) plus a live Docker container list — no new tracking needed.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hostId = Number(id);

  const host = getDb().prepare(`SELECT id, name, kind, docker_enabled FROM hosts WHERE id = ?`).get(hostId) as
    | HostRow
    | undefined;
  if (!host) return NextResponse.json({ error: "Machine introuvable." }, { status: 404 });

  const childHosts = getDb()
    .prepare(`SELECT id, name, kind FROM hosts WHERE parent_host_id = ?`)
    .all(hostId) as { id: number; name: string; kind: string }[];

  const linkedHosts = getDb()
    .prepare(
      `SELECT h.id, h.name, l.link_type FROM network_links l
       JOIN hosts h ON h.id = (CASE WHEN l.host_a_id = ? THEN l.host_b_id ELSE l.host_a_id END)
       WHERE l.host_a_id = ? OR l.host_b_id = ?`
    )
    .all(hostId, hostId, hostId) as { id: number; name: string; link_type: string }[];

  let containers: { id: string; name: string }[] = [];
  if (host.docker_enabled) {
    try {
      containers = (await listContainers(hostId))
        .filter((c) => c.state === "running")
        .map((c) => ({ id: c.id, name: c.name }));
    } catch {
      // SSH/Docker unreachable — impact preview just shows what it could determine, not an error.
    }
  }

  return NextResponse.json({ childHosts, linkedHosts, containers });
}
