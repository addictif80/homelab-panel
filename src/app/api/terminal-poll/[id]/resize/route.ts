import { NextRequest, NextResponse } from "next/server";
import { resizeSession } from "@/lib/terminalPollSessions";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const username = req.headers.get("x-panel-user");
  if (!username) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  const { id } = await params;
  const { cols, rows } = (await req.json().catch(() => ({}))) as { cols?: number; rows?: number };
  if (!cols || !rows) return NextResponse.json({ error: "Dimensions requises." }, { status: 400 });
  const ok = resizeSession(id, username, cols, rows);
  if (!ok) return NextResponse.json({ error: "Session introuvable ou fermée." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
