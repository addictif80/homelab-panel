import { NextRequest, NextResponse } from "next/server";
import { getDbConnection } from "@/lib/dbManager/sqlRunner";
import { createTable, listTables, type ColumnSpec } from "@/lib/dbManager/schema";
import { logAudit } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; db: string }> }) {
  const { id, db } = await params;
  try {
    const conn = getDbConnection(id);
    return NextResponse.json({ tables: await listTables(conn, decodeURIComponent(db)) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; db: string }> }) {
  const { id, db } = await params;
  const { name, columns } = (await req.json()) as { name?: string; columns?: ColumnSpec[] };
  if (!name?.trim() || !columns?.length) {
    return NextResponse.json({ error: "Nom de table et au moins une colonne requis." }, { status: 400 });
  }

  try {
    const conn = getDbConnection(id);
    await createTable(conn, decodeURIComponent(db), name.trim(), columns);
    logAudit("dbmanager.table_created", id, `${db}.${name}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
