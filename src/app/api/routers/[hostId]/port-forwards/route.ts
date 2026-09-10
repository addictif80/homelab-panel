import { NextRequest, NextResponse } from "next/server";
import { getRouterClient } from "@/lib/routers";
import { logAudit } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  try {
    const forwards = await getRouterClient(Number(hostId)).listPortForwards();
    return NextResponse.json({ forwards });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  const { protocol, externalPort, internalIp, internalPort, description, enabled } = await req.json();
  if (!protocol || !externalPort || !internalIp || !internalPort) {
    return NextResponse.json({ error: "Champs requis manquants." }, { status: 400 });
  }
  try {
    const forward = await getRouterClient(Number(hostId)).createPortForward({
      protocol,
      externalPort,
      internalIp,
      internalPort,
      description,
      enabled: enabled ?? true,
    });
    logAudit("router.port_forward_create", hostId, `${externalPort}->${internalIp}:${internalPort}`);
    return NextResponse.json({ forward });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
