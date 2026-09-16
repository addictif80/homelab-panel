import { NextRequest, NextResponse } from "next/server";
import { getDbConnection } from "@/lib/dbManager/sqlRunner";
import { dropDatabase } from "@/lib/dbManager/schema";
import { logAudit } from "@/lib/db";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; db: string }> }) {
  const { id, db } = await params;
  try {
    const conn = getDbConnection(id);
    await dropDatabase(conn, decodeURIComponent(db));
    logAudit("dbmanager.database_dropped", id, db);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
