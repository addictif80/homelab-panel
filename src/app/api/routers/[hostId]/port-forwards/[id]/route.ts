import { NextRequest, NextResponse } from "next/server";
import { getRouterClient } from "@/lib/routers";
import { logAudit } from "@/lib/db";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ hostId: string; id: string }> }) {
  const { hostId, id } = await params;
  try {
    await getRouterClient(Number(hostId)).deletePortForward(id);
    logAudit("router.port_forward_delete", hostId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
