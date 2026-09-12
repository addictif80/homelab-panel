import { NextRequest, NextResponse } from "next/server";
import { getDb, logAudit } from "@/lib/db";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  getDb().prepare(`DELETE FROM network_links WHERE id = ?`).run(id);
  logAudit("network_link.deleted", id);
  return NextResponse.json({ ok: true });
}
