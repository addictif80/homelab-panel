import { NextRequest, NextResponse } from "next/server";
import { getFrame } from "@/lib/rdp/session";

/** Plain GET, polled every ~700ms by RdpViewer.tsx — not a long-poll like the SSH terminal's
 * output endpoint, since a frame is a snapshot (the latest one) rather than an append-only stream
 * where "wait for the next chunk" makes sense. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const username = req.headers.get("x-panel-user");
  if (!username) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  const { id } = await params;

  const result = getFrame(id, username);
  if (!result) return NextResponse.json({ error: "Session introuvable ou fermée." }, { status: 404 });
  return NextResponse.json(result);
}
