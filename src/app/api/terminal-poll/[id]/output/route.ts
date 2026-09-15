import { NextRequest, NextResponse } from "next/server";
import { waitForOutput } from "@/lib/terminalPollSessions";

// Long enough to keep request volume low, short enough to stay well under any reverse proxy's
// idle-connection timeout (a plain slow GET, not a WebSocket upgrade, so ordinary HTTP timeouts
// apply).
const LONG_POLL_TIMEOUT_MS = 25_000;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const username = req.headers.get("x-panel-user");
  if (!username) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  const { id } = await params;
  const cursor = Number(req.nextUrl.searchParams.get("cursor") || "0");

  const result = await waitForOutput(id, username, cursor, LONG_POLL_TIMEOUT_MS);
  if (!result) return NextResponse.json({ error: "Session introuvable ou fermée." }, { status: 404 });
  return NextResponse.json(result);
}
