import { NextRequest, NextResponse } from "next/server";
import { getDbConnection } from "@/lib/dbManager/sqlRunner";
import { restoreDatabaseFromBase64 } from "@/lib/dbManager/dumpRestore";
import { logAudit } from "@/lib/db";
import { startJob, finishJob } from "@/lib/jobs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; db: string }> }) {
  const { id, db } = await params;
  const { base64, isGzip } = (await req.json()) as { base64?: string; isGzip?: boolean };
  if (!base64) return NextResponse.json({ error: "Fichier requis." }, { status: 400 });

  const database = decodeURIComponent(db);
  const conn = getDbConnection(id);
  const jobId = startJob("db-restore", `Restauration ${database}`, conn.hostId);

  restoreDatabaseFromBase64(conn, database, base64, Boolean(isGzip))
    .then(() => {
      logAudit("dbmanager.database_restored", id, db);
      finishJob(jobId, "success");
    })
    .catch((err) => {
      finishJob(jobId, "failed", { error: err instanceof Error ? err.message : "Erreur." });
    });

  return NextResponse.json({ jobId });
}
