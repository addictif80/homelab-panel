import { NextRequest, NextResponse } from "next/server";
import { getDb, logAudit } from "@/lib/db";
import { buildUpdateCommand, startUpdateJob, type UpdateMethod, type UpdateMode } from "@/lib/updates";

export async function POST(req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  const { mode, allowAutoReboot } = (await req.json()) as {
    mode: UpdateMode;
    allowAutoReboot: boolean;
  };

  if (!["dry-run", "apply"].includes(mode)) {
    return NextResponse.json({ error: "Mode invalide." }, { status: 400 });
  }

  const host = getDb().prepare(`SELECT update_method FROM hosts WHERE id = ?`).get(hostId) as
    | { update_method: UpdateMethod | null }
    | undefined;
  if (!host || !host.update_method) {
    return NextResponse.json({ error: "Aucune méthode de mise à jour définie pour cette machine." }, { status: 400 });
  }

  let command: string;
  try {
    command = buildUpdateCommand(host.update_method, mode, !!allowAutoReboot);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 400 });
  }

  logAudit(`update.${mode}`, hostId, command);

  const jobId = startUpdateJob(Number(hostId), mode, command);
  return NextResponse.json({ jobId }, { status: 202 });
}
