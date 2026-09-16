import { NextRequest, NextResponse } from "next/server";
import { applyFailover, getFailoverConfig, removeFailover } from "@/lib/npmFailover";
import { logAudit } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ failover: getFailoverConfig(Number(id)) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { scheme, host, port } = (await req.json()) as { scheme?: "http" | "https"; host?: string; port?: number };
  if (!scheme || !host?.trim() || !port) {
    return NextResponse.json({ error: "Schéma, hôte et port du serveur de secours requis." }, { status: 400 });
  }
  try {
    await applyFailover(Number(id), { scheme, host: host.trim(), port });
    logAudit("npm.failover_configured", id, `${scheme}://${host}:${port}`);
    return NextResponse.json({ failover: getFailoverConfig(Number(id)) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await removeFailover(Number(id));
    logAudit("npm.failover_removed", id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
