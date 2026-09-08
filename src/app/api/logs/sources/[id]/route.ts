import { NextRequest, NextResponse } from "next/server";
import { removeLogSource } from "@/lib/logSources";
import { logAudit } from "@/lib/db";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  removeLogSource(id);
  logAudit("logsource.deleted", id);
  return NextResponse.json({ ok: true });
}
