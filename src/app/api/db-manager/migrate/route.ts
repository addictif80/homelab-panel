import { NextRequest, NextResponse } from "next/server";
import { getDbConnection } from "@/lib/dbManager/sqlRunner";
import { migrateDatabaseDirect } from "@/lib/dbManager/dumpRestore";
import { logAudit } from "@/lib/db";
import { startJob, appendJobLog, finishJob } from "@/lib/jobs";

type Body = {
  sourceConnectionId?: string;
  sourceDatabase?: string;
  targetConnectionId?: string;
  targetDatabase?: string;
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body;
  const { sourceConnectionId, sourceDatabase, targetConnectionId, targetDatabase } = body;
  if (!sourceConnectionId || !sourceDatabase || !targetConnectionId || !targetDatabase) {
    return NextResponse.json({ error: "Champs requis manquants." }, { status: 400 });
  }

  let sourceConn, targetConn;
  try {
    sourceConn = getDbConnection(sourceConnectionId);
    targetConn = getDbConnection(targetConnectionId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Connexion introuvable." }, { status: 404 });
  }
  if (sourceConn.engine !== targetConn.engine) {
    return NextResponse.json({ error: "Les deux connexions doivent utiliser le même moteur (MySQL/MariaDB ou PostgreSQL)." }, { status: 400 });
  }

  const jobId = startJob("db-migrate", `Migration ${sourceDatabase} -> ${targetDatabase}`, targetConn.hostId);

  migrateDatabaseDirect(sourceConn, sourceDatabase, targetConn, targetDatabase)
    .then(() => {
      logAudit("dbmanager.database_migrated", sourceConnectionId, `${sourceDatabase} -> ${targetConnectionId}/${targetDatabase}`);
      appendJobLog(jobId, "Migration terminée.\n");
      finishJob(jobId, "success");
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : "Erreur inconnue.";
      appendJobLog(jobId, `Échec : ${message}\n`);
      finishJob(jobId, "failed", { error: message });
    });

  return NextResponse.json({ jobId });
}
