import { NextRequest, NextResponse } from "next/server";
import { containerAction } from "@/lib/docker";
import { logAudit } from "@/lib/db";

const ALLOWED = ["start", "stop", "restart", "remove"] as const;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ hostId: string; containerId: string }> }
) {
  const { hostId, containerId } = await params;
  const { action } = await req.json();
  if (!ALLOWED.includes(action)) {
    return NextResponse.json({ error: "Action invalide." }, { status: 400 });
  }
  try {
    await containerAction(Number(hostId), containerId, action);
    logAudit("docker.container_action", `${hostId}/${containerId}`, action);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur Docker." }, { status: 502 });
  }
}
