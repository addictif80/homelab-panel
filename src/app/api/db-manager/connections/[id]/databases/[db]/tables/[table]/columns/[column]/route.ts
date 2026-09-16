import { NextRequest, NextResponse } from "next/server";
import { getDbConnection } from "@/lib/dbManager/sqlRunner";
import { dropColumn } from "@/lib/dbManager/schema";
import { logAudit } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; db: string; table: string; column: string }> }
) {
  const { id, db, table, column } = await params;
  try {
    const conn = getDbConnection(id);
    await dropColumn(conn, decodeURIComponent(db), decodeURIComponent(table), decodeURIComponent(column));
    logAudit("dbmanager.column_dropped", id, `${db}.${table}.${column}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
