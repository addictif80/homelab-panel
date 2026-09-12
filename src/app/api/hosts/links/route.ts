import { NextRequest, NextResponse } from "next/server";
import { getDb, logAudit } from "@/lib/db";

const LINK_TYPES = ["lan", "tailscale", "cluster", "network"];

export async function POST(req: NextRequest) {
  const body = await req.json();
  const hostAId = Number(body.host_a_id);
  const hostBId = Number(body.host_b_id);
  const linkType = typeof body.link_type === "string" ? body.link_type : "network";

  if (!hostAId || !hostBId) {
    return NextResponse.json({ error: "Les deux machines sont requises." }, { status: 400 });
  }
  if (hostAId === hostBId) {
    return NextResponse.json({ error: "Une machine ne peut pas être reliée à elle-même." }, { status: 400 });
  }
  if (!LINK_TYPES.includes(linkType)) {
    return NextResponse.json({ error: "Type de lien invalide." }, { status: 400 });
  }

  const db = getDb();
  const hosts = db
    .prepare(`SELECT id FROM hosts WHERE id IN (?, ?)`)
    .all(hostAId, hostBId) as { id: number }[];
  if (hosts.length !== 2) {
    return NextResponse.json({ error: "Machine introuvable." }, { status: 404 });
  }

  // Order-independent: a-b and b-a are the same link, so check both directions before inserting.
  const existing = db
    .prepare(
      `SELECT id FROM network_links WHERE (host_a_id = ? AND host_b_id = ?) OR (host_a_id = ? AND host_b_id = ?)`
    )
    .get(hostAId, hostBId, hostBId, hostAId);
  if (existing) {
    return NextResponse.json({ error: "Ce lien existe déjà." }, { status: 409 });
  }

  const info = db
    .prepare(`INSERT INTO network_links (host_a_id, host_b_id, link_type) VALUES (?, ?, ?)`)
    .run(hostAId, hostBId, linkType);
  logAudit("network_link.created", String(info.lastInsertRowid), `${hostAId} <-> ${hostBId} (${linkType})`);
  return NextResponse.json({ id: info.lastInsertRowid }, { status: 201 });
}
