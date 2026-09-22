import { NextRequest, NextResponse } from "next/server";
import { sendInput, type RdpInput } from "@/lib/rdp/session";

const VALID_TYPES = new Set(["mousemove", "mousedown", "mouseup", "scroll", "keydown", "keyup", "text"]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const username = req.headers.get("x-panel-user");
  if (!username) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  const { id } = await params;

  const input = (await req.json().catch(() => null)) as RdpInput | null;
  if (!input || typeof input.type !== "string" || !VALID_TYPES.has(input.type)) {
    return NextResponse.json({ error: "Entrée invalide." }, { status: 400 });
  }

  const ok = sendInput(id, username, input);
  if (!ok) return NextResponse.json({ error: "Session introuvable ou fermée." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
