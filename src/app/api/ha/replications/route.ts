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
  };

  if (!body.name?.trim() || !body.kind || !body.sourceHostId || !body.targetHostId || !body.sourcePath?.trim() || !body.targetPath?.trim()) {
    return NextResponse.json({ error: "Nom, type, machines source/cible et chemins requis." }, { status: 400 });
  }
  if (!["folder", "mysql", "postgres", "sqlite"].includes(body.kind)) {
    return NextResponse.json({ error: "Type de réplication invalide." }, { status: 400 });
  }
  if (body.sourceHostId === body.targetHostId) {
    return NextResponse.json({ error: "La machine source et la machine cible doivent être différentes." }, { status: 400 });
  }
  if ((body.kind === "mysql" || body.kind === "postgres") && (!body.dbUser?.trim() || !body.dbPassword)) {
    return NextResponse.json(
      { error: "Identifiant et mot de passe administrateur requis (valides sur les deux machines) pour ce type de réplication." },
      { status: 400 }
    );
  }

  const replication = createReplication({
    name: body.name,
    kind: body.kind,
    sourceHostId: body.sourceHostId,
    targetHostId: body.targetHostId,
    sourcePath: body.sourcePath,
    targetPath: body.targetPath,
    dbPort: body.dbPort,
    dbUser: body.dbUser,
    dbPassword: body.dbPassword,
  });
  logAudit("ha.replication_created", replication.id, `${body.kind} ${body.sourceHostId}->${body.targetHostId}`);
  return NextResponse.json({ replication });
}
