import { NextRequest, NextResponse } from "next/server";
import { getRouterClient } from "@/lib/routers";
import { logAudit } from "@/lib/db";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  try {
    await getRouterClient(Number(hostId)).reboot();
    logAudit("router.reboot", hostId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
