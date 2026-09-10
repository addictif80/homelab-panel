import { NextRequest, NextResponse } from "next/server";
import { updateRecord, deleteRecord } from "@/lib/dns";
import { logAudit } from "@/lib/db";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { type, name, content, ttl, proxied } = await req.json();
  if (!type || !name || !content) {
    return NextResponse.json({ error: "Type, nom et contenu requis." }, { status: 400 });
  }
  try {
    const record = await updateRecord(id, { type, name, content, ttl, proxied });
    logAudit("dns.record_update", name, type);
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur DNS." },
      { status: 502 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await deleteRecord(id);
    logAudit("dns.record_delete", id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur DNS." },
      { status: 502 }
    );
  }
}
