import { NextRequest, NextResponse } from "next/server";
import { writeToSession } from "@/lib/terminalPollSessions";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const username = req.headers.get("x-panel-user");
  if (!username) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  const { id } = await params;
  const { data } = (await req.json().catch(() => ({}))) as { data?: string };
  if (typeof data !== "string") return NextResponse.json({ error: "Données requises." }, { status: 400 });
  const ok = writeToSession(id, username, data);
  if (!ok) return NextResponse.json({ error: "Session introuvable ou fermée." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
