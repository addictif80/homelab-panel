import { NextRequest, NextResponse } from "next/server";
import { getRouterClient } from "@/lib/routers";
import { logAudit } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ hostId: string; id: string }> }) {
  const { hostId, id } = await params;
  const { enabled } = (await req.json()) as { enabled?: boolean };
  try {
    await getRouterClient(Number(hostId)).setWifiEnabled(id, !!enabled);
    logAudit("router.wifi_toggle", hostId, `${id}=${enabled}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
