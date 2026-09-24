import { NextRequest, NextResponse } from "next/server";
import { closeBrowserSession } from "@/lib/browserSession";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const username = req.headers.get("x-panel-user");
  if (!username) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  const { id } = await params;
  closeBrowserSession(id, username);
  return NextResponse.json({ ok: true });
}
