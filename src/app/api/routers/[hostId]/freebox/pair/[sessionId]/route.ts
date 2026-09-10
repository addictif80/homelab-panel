import { NextRequest, NextResponse } from "next/server";
import { getPairingHandle, discardPairingHandle, pollPairing } from "@/lib/routers/freebox";
import { setRouterProvider, setRouterConfig } from "@/lib/routers";
import { logAudit } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ hostId: string; sessionId: string }> }
) {
  const { hostId, sessionId } = await params;
  const handle = getPairingHandle(sessionId);
  if (!handle) return NextResponse.json({ error: "Session d'appairage introuvable ou expirée." }, { status: 404 });

  try {
    const status = await pollPairing(handle);
    if (status === "granted") {
      setRouterProvider(Number(hostId), "freebox");
      setRouterConfig(Number(hostId), { baseUrl: new URL(handle.apiUrl).origin }, { appToken: handle.appToken });
      discardPairingHandle(sessionId);
      logAudit("router.freebox_paired", hostId);
    } else if (status === "denied" || status === "timeout") {
      discardPairingHandle(sessionId);
    }
    return NextResponse.json({ status });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
