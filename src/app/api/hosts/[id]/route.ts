import { NextRequest, NextResponse } from "next/server";
import { getDb, logAudit } from "@/lib/db";

const EDITABLE_FIELDS = [
  "name",
  "role",
  "os",
  "cluster",
  "lan_ip",
  "tailscale_ip",
  "public_ip",
  "ssh_port",
  "ssh_user",
  "docker_enabled",
  "update_method",
  "notes",
] as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const db = getDb();

  const host = db.prepare(`SELECT id FROM hosts WHERE id = ?`).get(id);
  if (!host) return NextResponse.json({ error: "Machine introuvable." }, { status: 404 });

  const updates: string[] = [];
  const values: Record<string, unknown> = { id };
  for (const field of EDITABLE_FIELDS) {
    if (field in body) {
      updates.push(`${field} = @${field}`);
      values[field] = body[field];
    }
  }
  if (updates.length === 0) {
    return NextResponse.json({ error: "Aucun champ à mettre à jour." }, { status: 400 });
  }

  db.prepare(`UPDATE hosts SET ${updates.join(", ")} WHERE id = @id`).run(values);
  logAudit("host.updated", id, JSON.stringify(Object.keys(body)));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  db.prepare(`DELETE FROM hosts WHERE id = ?`).run(id);
  logAudit("host.deleted", id);
  return NextResponse.json({ ok: true });
}
