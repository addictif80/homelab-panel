import { NextRequest, NextResponse } from "next/server";
import { getDb, logAudit } from "@/lib/db";
import { vaultEncrypt } from "@/lib/crypto";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = getDb()
    .prepare(`SELECT id, kind, label, created_at FROM credentials WHERE host_id = ? ORDER BY created_at DESC`)
    .all(id);
  return NextResponse.json({ credentials: rows });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { kind, label, secret } = await req.json();

  if (!["ssh_key", "ssh_password", "sudo_password", "api_token"].includes(kind)) {
    return NextResponse.json({ error: "Type de credential invalide." }, { status: 400 });
  }
  if (!secret || typeof secret !== "string") {
    return NextResponse.json({ error: "Secret requis." }, { status: 400 });
  }

  const host = getDb().prepare(`SELECT id FROM hosts WHERE id = ?`).get(id);
  if (!host) return NextResponse.json({ error: "Machine introuvable." }, { status: 404 });

  const encrypted = vaultEncrypt(secret);
  const info = getDb()
    .prepare(`INSERT INTO credentials (host_id, kind, label, encrypted_data) VALUES (?, ?, ?, ?)`)
    .run(id, kind, label ?? null, encrypted);

  logAudit("credential.created", id, kind);
  return NextResponse.json({ id: info.lastInsertRowid }, { status: 201 });
}
