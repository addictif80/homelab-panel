import { NextRequest, NextResponse } from "next/server";
import { listRecords, createRecord } from "@/lib/dns";
import { logAudit } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ zoneId: string }> }) {
  const { zoneId } = await params;
  try {
    const records = await listRecords(zoneId);
    return NextResponse.json({ records });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur DNS." }, { status: 502 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ zoneId: string }> }) {
  const { zoneId } = await params;
  const { type, name, content, ttl, proxied } = await req.json();
  if (!type || !name || !content) {
    return NextResponse.json({ error: "Type, nom et contenu requis." }, { status: 400 });
  }
  try {
    const record = await createRecord(zoneId, { type, name, content, ttl, proxied });
    logAudit("dns.record_create", name, type);
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur DNS." }, { status: 502 });
  }
}
