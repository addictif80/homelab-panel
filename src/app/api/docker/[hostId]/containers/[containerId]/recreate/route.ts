import { NextRequest, NextResponse } from "next/server";
import { pullAndRecreate } from "@/lib/docker";
import { logAudit } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ hostId: string; containerId: string }> }
) {
  const { hostId, containerId } = await params;
  try {
    const log = await pullAndRecreate(Number(hostId), containerId);
    logAudit("docker.recreate", `${hostId}/${containerId}`);
    return NextResponse.json({ log });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur Docker." }, { status: 502 });
  }
}
