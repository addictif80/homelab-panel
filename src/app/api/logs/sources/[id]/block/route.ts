import { NextRequest, NextResponse } from "next/server";
import { getLogSource } from "@/lib/logSources";
import { blockIp } from "@/lib/firewall";
import { logAudit } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ip } = await req.json();
  if (!ip) return NextResponse.json({ error: "IP requise." }, { status: 400 });

  const source = getLogSource(id);
  if (!source) return NextResponse.json({ error: "Source de logs introuvable." }, { status: 404 });

  try {
    await blockIp(source.hostId, ip);
    logAudit("firewall.block", `${source.hostId}`, ip);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
