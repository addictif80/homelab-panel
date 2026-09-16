import { NextRequest, NextResponse } from "next/server";
import { getDbConnection } from "@/lib/dbManager/sqlRunner";
import { restoreDatabaseFromBase64 } from "@/lib/dbManager/dumpRestore";
import { logAudit } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; db: string }> }) {
  const { id, db } = await params;
  const { base64, isGzip } = (await req.json()) as { base64?: string; isGzip?: boolean };
  if (!base64) return NextResponse.json({ error: "Fichier requis." }, { status: 400 });

  try {
    const conn = getDbConnection(id);
    await restoreDatabaseFromBase64(conn, decodeURIComponent(db), base64, Boolean(isGzip));
    logAudit("dbmanager.database_restored", id, db);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
