import { NextRequest, NextResponse } from "next/server";
import { createRdpSession, checkRdpDependencies } from "@/lib/rdp/session";
import { isDemoContext } from "@/lib/demo/context";

/** Creates a new RDP session (Xvfb + xfreerdp pointed at it) for a host with RDP credentials on
 * file. Polled over HTTP by RdpViewer.tsx — no WebSocket, same reasoning as /api/terminal-poll. */
export async function POST(req: NextRequest) {
  const username = req.headers.get("x-panel-user");
  if (!username) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  if (isDemoContext()) {
    return NextResponse.json(
      { error: "Le client RDP n'est pas disponible en mode démo (aucun serveur Windows réel à contacter)." },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const hostId = Number(body.hostId);
  if (!hostId) return NextResponse.json({ error: "Machine requise." }, { status: 400 });

  const missingDeps = await checkRdpDependencies();
  if (missingDeps) return NextResponse.json({ error: missingDeps }, { status: 400 });

  try {
    const sessionId = createRdpSession(hostId, username);
    return NextResponse.json({ sessionId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur inconnue." }, { status: 400 });
  }
}
