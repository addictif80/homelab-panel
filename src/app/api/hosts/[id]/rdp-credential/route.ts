import { NextRequest, NextResponse } from "next/server";
import { getDb, logAudit } from "@/lib/db";
import { vaultEncrypt } from "@/lib/crypto";

/** One row per host (see the rdp_credentials table comment in lib/db.ts) — never returns the
 * decrypted password, just enough to know a credential exists and show its username/port. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getDb().prepare(`SELECT port, username, created_at FROM rdp_credentials WHERE host_id = ?`).get(id);
  return NextResponse.json({ credential: row ?? null });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { port, username, password } = await req.json();

  if (!username || typeof username !== "string") {
    return NextResponse.json({ error: "Nom d'utilisateur requis." }, { status: 400 });
  }
  if (!password || typeof password !== "string") {
    return NextResponse.json({ error: "Mot de passe requis." }, { status: 400 });
  }
  const rdpPort = Number(port) || 3389;

  const host = getDb().prepare(`SELECT id FROM hosts WHERE id = ?`).get(id);
  if (!host) return NextResponse.json({ error: "Machine introuvable." }, { status: 404 });

  const encrypted = vaultEncrypt(password);
  getDb()
    .prepare(
      `INSERT INTO rdp_credentials (host_id, port, username, password_encrypted) VALUES (?, ?, ?, ?)
       ON CONFLICT(host_id) DO UPDATE SET port = excluded.port, username = excluded.username, password_encrypted = excluded.password_encrypted`
    )
    .run(id, rdpPort, username, encrypted);

  logAudit("rdp_credential.saved", id, username);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  getDb().prepare(`DELETE FROM rdp_credentials WHERE host_id = ?`).run(id);
  logAudit("rdp_credential.deleted", id, "");
  return NextResponse.json({ ok: true });
}
