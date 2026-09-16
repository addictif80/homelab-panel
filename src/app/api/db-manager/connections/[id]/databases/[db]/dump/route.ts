import { NextRequest, NextResponse } from "next/server";
import { getDbConnection } from "@/lib/dbManager/sqlRunner";
import { dumpDatabaseToBase64 } from "@/lib/dbManager/dumpRestore";
import { logAudit } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; db: string }> }) {
  const { id, db } = await params;
  try {
    const conn = getDbConnection(id);
    const result = await dumpDatabaseToBase64(conn, decodeURIComponent(db));
    logAudit("dbmanager.database_dumped", id, db);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
