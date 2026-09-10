import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { startPairing, savePairingHandle } from "@/lib/routers/freebox";

export async function POST(req: NextRequest) {
  const { baseUrl } = (await req.json()) as { baseUrl?: string };
  if (!baseUrl) return NextResponse.json({ error: "URL de la Freebox requise." }, { status: 400 });

  try {
    const handle = await startPairing(baseUrl);
    const sessionId = randomUUID();
    savePairingHandle(sessionId, handle);
    return NextResponse.json({ sessionId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
