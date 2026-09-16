import { NextRequest, NextResponse } from "next/server";
import { createPollSession } from "@/lib/terminalPollSessions";

/** Creates a new polling-backed SSH session — the fallback transport Terminal.tsx switches to
 * when the WebSocket upgrade never completes (see /ws/ssh and sshChannel.ts). */
export async function POST(req: NextRequest) {
  const username = req.headers.get("x-panel-user");
  if (!username) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const hostId = Number(body.hostId);
  const containerId = typeof body.containerId === "string" ? body.containerId : null;
  const execKind = body.execKind === "pct" ? "pct" : "docker";
  if (!hostId) return NextResponse.json({ error: "Machine requise." }, { status: 400 });

  const sessionId = createPollSession(hostId, containerId ? { kind: execKind, id: containerId } : null, username);
  return NextResponse.json({ sessionId });
}
