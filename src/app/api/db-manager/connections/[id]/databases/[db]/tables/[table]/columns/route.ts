import { NextRequest, NextResponse } from "next/server";
import { getDbConnection } from "@/lib/dbManager/sqlRunner";
import { addColumn, type ColumnSpec } from "@/lib/dbManager/schema";
import { logAudit } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; db: string; table: string }> }
) {
  const { id, db, table } = await params;
  const column = (await req.json()) as ColumnSpec;
  if (!column?.name?.trim() || !column?.type?.trim()) {
    return NextResponse.json({ error: "Nom et type de colonne requis." }, { status: 400 });
  }

  try {
    const conn = getDbConnection(id);
    await addColumn(conn, decodeURIComponent(db), decodeURIComponent(table), column);
    logAudit("dbmanager.column_added", id, `${db}.${table}.${column.name}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
