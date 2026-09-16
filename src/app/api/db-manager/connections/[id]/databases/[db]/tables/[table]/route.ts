import { NextRequest, NextResponse } from "next/server";
import { getDbConnection } from "@/lib/dbManager/sqlRunner";
import { describeTable, dropTable } from "@/lib/dbManager/schema";
import { logAudit } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; db: string; table: string }> }
) {
  const { id, db, table } = await params;
  try {
    const conn = getDbConnection(id);
    const columns = await describeTable(conn, decodeURIComponent(db), decodeURIComponent(table));
    return NextResponse.json({ columns });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; db: string; table: string }> }
) {
  const { id, db, table } = await params;
  try {
    const conn = getDbConnection(id);
    await dropTable(conn, decodeURIComponent(db), decodeURIComponent(table));
    logAudit("dbmanager.table_dropped", id, `${db}.${table}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
