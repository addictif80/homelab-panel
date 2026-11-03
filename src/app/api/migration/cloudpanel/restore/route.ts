import { NextRequest, NextResponse } from "next/server";
import { restoreCloudPanelFiles, restoreCloudPanelDatabase } from "@/lib/migration/cloudpanelImport";
import { getDbConnection } from "@/lib/dbManager/sqlRunner";
import { logAudit } from "@/lib/db";
import { startJob, appendJobLog, finishJob } from "@/lib/jobs";

type Body = {
  nasHostId?: number;
  backupRoot?: string;
  site?: string;
  domain?: string;
  targetHostId?: number;
  targetContainerId?: string;
  targetDomain?: string;
  excludePatterns?: string[];
  wipeFirst?: boolean;
  dbConnectionId?: string;
  targetDatabase?: string;
  memberPath?: string;
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body;
  const { nasHostId, backupRoot, site, domain, targetHostId, targetContainerId, targetDomain } = body;
  if (!nasHostId || !backupRoot || !site || !domain || !targetHostId || !targetContainerId || !targetDomain) {
    return NextResponse.json({ error: "Champs requis manquants pour la restauration des fichiers." }, { status: 400 });
  }

  const restoreDb = !!(body.dbConnectionId && body.targetDatabase && body.memberPath);
  let targetConn;
  if (restoreDb) {
    try {
      targetConn = getDbConnection(body.dbConnectionId!);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Connexion base introuvable." }, { status: 404 });
    }
  }

  const jobId = startJob("cloudpanel-migrate", `Restauration ${targetDomain} depuis ${site}`, targetHostId);

  (async () => {
    appendJobLog(jobId, `Restauration des fichiers (${domain} -> /home/${targetDomain}/public_html)...\n`);
    await restoreCloudPanelFiles({
      nasHostId,
      backupRoot,
      site,
      domain,
      targetHostId,
      targetContainerId,
      targetDomain,
      excludePatterns: body.excludePatterns ?? [],
      wipeFirst: body.wipeFirst ?? true,
    });
    appendJobLog(jobId, "Fichiers restaurés.\n");

    if (restoreDb && targetConn) {
      appendJobLog(jobId, `Import de la base "${body.targetDatabase}"...\n`);
      await restoreCloudPanelDatabase({
        nasHostId,
        backupRoot,
        site,
        memberPath: body.memberPath!,
        targetConn,
        targetDatabase: body.targetDatabase!,
      });
      appendJobLog(jobId, "Base de données importée.\n");
    }

    logAudit("migration.cloudpanel_restored", String(targetHostId), `${site} -> ${targetDomain}`);
    finishJob(jobId, "success");
  })().catch((err) => {
    const message = err instanceof Error ? err.message : "Erreur inconnue.";
    appendJobLog(jobId, `Échec : ${message}\n`);
    finishJob(jobId, "failed", { error: message });
  });

  return NextResponse.json({ jobId });
}
