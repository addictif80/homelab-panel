import { NextRequest, NextResponse } from "next/server";
import { getDbConnection, runSql } from "@/lib/dbManager/sqlRunner";
import { logAudit } from "@/lib/db";

/** Runs arbitrary SQL the user typed into the query editor — the escape hatch for anything the
 * dedicated table/column UI doesn't cover. Only the last statement's own result set (if any)
 * comes back in structured form when the text contains several ';'-separated statements, since
 * that's all the CLI's own stdout naturally gives us; still runs every statement in order. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; db: string }> }) {
  const { id, db } = await params;
  const { sql } = (await req.json()) as { sql?: string };
  if (!sql?.trim()) return NextResponse.json({ error: "Requête SQL vide." }, { status: 400 });

  try {
    const conn = getDbConnection(id);
    const result = await runSql(conn, sql, decodeURIComponent(db));
    logAudit("dbmanager.query_run", id, db);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
