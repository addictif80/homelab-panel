import { NextRequest, NextResponse } from "next/server";
import { getDb, logAudit } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; credId: string }> }
) {
  const { id, credId } = await params;
  getDb().prepare(`DELETE FROM credentials WHERE id = ? AND host_id = ?`).run(credId, id);
  logAudit("credential.deleted", id, credId);
  return NextResponse.json({ ok: true });
}
