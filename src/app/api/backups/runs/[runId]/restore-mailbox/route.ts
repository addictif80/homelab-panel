import { NextRequest, NextResponse } from "next/server";
import { getRun } from "@/lib/backup/runs";
import { getPlan } from "@/lib/backup/plans";
import { restoreMailboxFromSnapshot } from "@/lib/backup/mailboxRestore";
import { logAudit } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = getRun(runId);
  if (!run) return NextResponse.json({ error: "Sauvegarde introuvable." }, { status: 404 });
  if (run.status !== "success" || !run.snapshotPath) {
    return NextResponse.json({ error: "Cette sauvegarde n'a pas de snapshot exploitable." }, { status: 400 });
  }
  const plan = getPlan(run.planId);
  if (!plan || plan.sourceType !== "mailbox") {
    return NextResponse.json({ error: "Plan de boîte mail introuvable." }, { status: 404 });
  }

  const body = (await req.json()) as {
    mailbox?: string;
    targetHostId?: number;
    targetDeployment?: "docker" | "native";
    targetContainerId?: string;
    targetMailbox?: string;
  };
  if (!body.mailbox || !body.targetHostId || !body.targetMailbox) {
    return NextResponse.json({ error: "Boîte source, machine cible et boîte cible requises." }, { status: 400 });
  }
  if (body.targetDeployment !== "native" && !body.targetContainerId) {
    return NextResponse.json({ error: "Conteneur Dovecot cible requis." }, { status: 400 });
  }

  const restoreRunId = restoreMailboxFromSnapshot(
    plan.id,
    plan.destHostId,
    run.snapshotPath,
    body.mailbox,
    body.targetHostId,
    { deployment: body.targetDeployment, containerId: body.targetContainerId },
    body.targetMailbox
  );
  logAudit("backup.mailbox_restore_started", plan.id, `${body.mailbox} -> ${body.targetMailbox} (host ${body.targetHostId})`);
  return NextResponse.json({ runId: restoreRunId }, { status: 202 });
}
