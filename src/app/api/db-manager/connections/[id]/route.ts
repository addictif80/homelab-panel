import { NextRequest, NextResponse } from "next/server";
import { deleteDbConnection } from "@/lib/dbManager/dbConnections";
import { logAudit } from "@/lib/db";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deleteDbConnection(id);
  logAudit("dbmanager.connection_removed", id);
  return NextResponse.json({ ok: true });
}
