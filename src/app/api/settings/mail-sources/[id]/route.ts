import { NextRequest, NextResponse } from "next/server";
import { deleteMailLogSource, setMailLogSourceEnabled } from "@/lib/mail/mailIngest";
import { logAudit } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { enabled } = (await req.json()) as { enabled?: boolean };
  if (typeof enabled !== "boolean") return NextResponse.json({ error: "Champ 'enabled' requis." }, { status: 400 });
  setMailLogSourceEnabled(id, enabled);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deleteMailLogSource(id);
  logAudit("mail.source_removed", id);
  return NextResponse.json({ ok: true });
}
