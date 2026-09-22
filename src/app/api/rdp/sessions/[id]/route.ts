import { NextRequest, NextResponse } from "next/server";
import { closeRdpSession } from "@/lib/rdp/session";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const username = req.headers.get("x-panel-user");
  if (!username) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  const { id } = await params;
  closeRdpSession(id, username);
  return NextResponse.json({ ok: true });
}
