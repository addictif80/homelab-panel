import { NextRequest, NextResponse } from "next/server";
import { getDbConnection } from "@/lib/dbManager/sqlRunner";
import { browseTable, insertRow, updateRow, deleteRow } from "@/lib/dbManager/dataOps";
import { logAudit } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; db: string; table: string }> }
) {
  const { id, db, table } = await params;
  const page = parseInt(req.nextUrl.searchParams.get("page") || "0", 10) || 0;
  try {
    const conn = getDbConnection(id);
    const result = await browseTable(conn, decodeURIComponent(db), decodeURIComponent(table), page);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; db: string; table: string }> }
) {
  const { id, db, table } = await params;
  const { values } = (await req.json()) as { values?: Record<string, string | null> };
  if (!values) return NextResponse.json({ error: "Valeurs requises." }, { status: 400 });

  try {
    const conn = getDbConnection(id);
    await insertRow(conn, decodeURIComponent(db), decodeURIComponent(table), values);
    logAudit("dbmanager.row_inserted", id, `${db}.${table}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; db: string; table: string }> }
) {
  const { id, db, table } = await params;
  const { primaryKey, values } = (await req.json()) as {
    primaryKey?: Record<string, string | null>;
    values?: Record<string, string | null>;
  };
  if (!primaryKey || !values) return NextResponse.json({ error: "Clé primaire et valeurs requises." }, { status: 400 });

  try {
    const conn = getDbConnection(id);
    await updateRow(conn, decodeURIComponent(db), decodeURIComponent(table), primaryKey, values);
    logAudit("dbmanager.row_updated", id, `${db}.${table}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; db: string; table: string }> }
) {
  const { id, db, table } = await params;
  const { primaryKey } = (await req.json()) as { primaryKey?: Record<string, string | null> };
  if (!primaryKey) return NextResponse.json({ error: "Clé primaire requise." }, { status: 400 });

  try {
    const conn = getDbConnection(id);
    await deleteRow(conn, decodeURIComponent(db), decodeURIComponent(table), primaryKey);
    logAudit("dbmanager.row_deleted", id, `${db}.${table}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
