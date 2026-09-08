import { NextRequest, NextResponse } from "next/server";
import { getDb, logAudit } from "@/lib/db";
import { vaultEncrypt } from "@/lib/crypto";
import { getProxmoxConfig } from "@/lib/proxmox";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  const config = getProxmoxConfig(Number(hostId));
  return NextResponse.json({
    configured: !!config,
    tokenId: config?.tokenId ?? null,
    port: config?.port ?? 8006,
    verifySsl: config?.verifySsl ?? false,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  const { tokenId, secret, port, verifySsl } = await req.json();

  if (!tokenId || !secret) {
    return NextResponse.json({ error: "Token ID et secret requis." }, { status: 400 });
  }

  const host = getDb().prepare(`SELECT id FROM hosts WHERE id = ?`).get(hostId);
  if (!host) return NextResponse.json({ error: "Machine introuvable." }, { status: 404 });

  const db = getDb();
  db.prepare(`DELETE FROM credentials WHERE host_id = ? AND kind = 'api_token' AND label = 'proxmox'`).run(
    hostId
  );
  const payload = JSON.stringify({ tokenId, secret, port: port || 8006, verifySsl: !!verifySsl });
  db.prepare(`INSERT INTO credentials (host_id, kind, label, encrypted_data) VALUES (?, 'api_token', 'proxmox', ?)`).run(
    hostId,
    vaultEncrypt(payload)
  );

  logAudit("proxmox.configured", hostId);
  return NextResponse.json({ ok: true });
}
