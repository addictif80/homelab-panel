import { NextRequest, NextResponse } from "next/server";
import { getDbConnection } from "@/lib/dbManager/sqlRunner";
import { dumpDatabaseToStream } from "@/lib/dbManager/dumpRestore";
import { logAudit } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; db: string }> }) {
  const { id, db } = await params;
  try {
    const conn = getDbConnection(id);
    const { webStream, filename } = await dumpDatabaseToStream(conn, decodeURIComponent(db));
    logAudit("dbmanager.database_dumped", id, db);
    return new Response(webStream, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
