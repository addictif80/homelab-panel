import { NextRequest, NextResponse } from "next/server";
import { navigate, type BrowserNavigate } from "@/lib/browserSession";

const VALID_ACTIONS = new Set(["goto", "back", "forward", "reload"]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const username = req.headers.get("x-panel-user");
  if (!username) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  const { id } = await params;

  const nav = (await req.json().catch(() => null)) as BrowserNavigate | null;
  if (!nav || typeof nav.action !== "string" || !VALID_ACTIONS.has(nav.action)) {
    return NextResponse.json({ error: "Action invalide." }, { status: 400 });
  }
  if (nav.action === "goto" && typeof (nav as { url?: unknown }).url !== "string") {
    return NextResponse.json({ error: "Adresse requise." }, { status: 400 });
  }

  const ok = await navigate(id, username, nav);
  if (!ok) return NextResponse.json({ error: "Session introuvable ou fermée." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
