import { NextRequest, NextResponse } from "next/server";
import { deleteProxyHost, updateProxyHost, type ProxyHostInput } from "@/lib/npm";
import { logAudit } from "@/lib/db";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as ProxyHostInput;
  try {
    const host = await updateProxyHost(Number(id), body);
    logAudit("npm.host_updated", id);
    return NextResponse.json({ host });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await deleteProxyHost(Number(id));
    logAudit("npm.host_deleted", id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
