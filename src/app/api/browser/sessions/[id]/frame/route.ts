import { NextRequest, NextResponse } from "next/server";
import { waitForFrame } from "@/lib/browserSession";

// Long-polls, like the SSH terminal's output endpoint — a new frame resolves it immediately (see
// Page.screencastFrame in lib/browserSession.ts), so this gives near-real-time updates without a
// fixed poll interval, unlike the RDP viewer's plain "poll every 700ms" (RDP has no event to wait
// on — its frames come from a fixed-interval screenshot timer, not a push from the remote side).
const LONG_POLL_TIMEOUT_MS = 25_000;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const username = req.headers.get("x-panel-user");
  if (!username) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  const { id } = await params;
  const sinceSeq = Number(req.nextUrl.searchParams.get("seq") || "0");

  const result = await waitForFrame(id, username, sinceSeq, LONG_POLL_TIMEOUT_MS);
  if (!result) return NextResponse.json({ error: "Session introuvable ou fermée." }, { status: 404 });
  return NextResponse.json(result);
}
