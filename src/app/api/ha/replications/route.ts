import { NextRequest, NextResponse } from "next/server";
import { listReplications, createReplication, type ReplicationKind } from "@/lib/ha";
import { logAudit } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ replications: listReplications() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    name?: string;
    kind?: ReplicationKind;
    sourceHostId?: number;
    targetHostId?: number;
    sourcePath?: string;
    targetPath?: string;
    dbPort?: number;
    dbUser?: string;
    dbPassword?: string;
    targetDbUser?: string;
    targetDbPassword?: string;
    proxyHostId?: number;
    targetPort?: number;
    targetOwner?: string;
    targetMode?: string;
    appDbUser?: string;
    appDbPassword?: string;
  };

  const isDbKind = body.kind === "mysql" || body.kind === "postgres";

  if (!body.name?.trim() || !body.kind || !body.sourceHostId || !body.targetHostId || !body.sourcePath?.trim()) {
    return NextResponse.json({ error: "Nom, type, machines source/cible et chemin(s)/base(s) requis." }, { status: 400 });
  }
  // Native mysql/postgres replication can't rename a database in flight — the target ends up with
  // exactly the same name(s) as the source no matter what's typed here, so that field is dropped
  // for these two kinds rather than left to imply a rename that will never actually happen.
  if (!isDbKind && !body.targetPath?.trim()) {
    return NextResponse.json({ error: "Chemin/fichier cible requis." }, { status: 400 });
  }
  if (!["folder", "mysql", "postgres", "sqlite"].includes(body.kind)) {
    return NextResponse.json({ error: "Type de réplication invalide." }, { status: 400 });
  }
  if (body.sourceHostId === body.targetHostId) {
    return NextResponse.json({ error: "La machine source et la machine cible doivent être différentes." }, { status: 400 });
  }
  if (isDbKind && (!body.dbUser?.trim() || !body.dbPassword)) {
    return NextResponse.json(
      { error: "Identifiant et mot de passe administrateur requis pour la machine source." },
      { status: 400 }
    );
  }
  if (isDbKind && (!!body.targetDbUser?.trim() !== !!body.targetDbPassword)) {
    return NextResponse.json(
      { error: "Identifiants administrateur de la machine cible : renseigne l'utilisateur et le mot de passe ensemble, ou laisse les deux vides." },
      { status: 400 }
    );
  }

  const replication = createReplication({
    name: body.name,
    kind: body.kind,
    sourceHostId: body.sourceHostId,
    targetHostId: body.targetHostId,
    sourcePath: body.sourcePath,
    targetPath: isDbKind ? body.sourcePath : body.targetPath!,
    dbPort: body.dbPort,
    dbUser: body.dbUser,
    dbPassword: body.dbPassword,
    targetDbUser: body.targetDbUser,
    targetDbPassword: body.targetDbPassword,
    proxyHostId: body.proxyHostId,
    targetPort: body.targetPort,
    targetOwner: body.targetOwner,
    targetMode: body.targetMode,
    appDbUser: body.appDbUser,
    appDbPassword: body.appDbPassword,
  });
  logAudit("ha.replication_created", replication.id, `${body.kind} ${body.sourceHostId}->${body.targetHostId}`);
  return NextResponse.json({ replication });
}
