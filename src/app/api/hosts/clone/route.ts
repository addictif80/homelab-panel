import { NextRequest, NextResponse } from "next/server";
import { cloneHostToNewMachine } from "@/lib/backup/resurrect";
import { logAudit } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { sourceHostId, targetHostId } = (await req.json()) as { sourceHostId?: number; targetHostId?: number };
  if (!sourceHostId || !targetHostId) {
    return NextResponse.json({ error: "Machine source et machine cible requises." }, { status: 400 });
  }
  if (sourceHostId === targetHostId) {
    return NextResponse.json({ error: "La machine cible doit être différente de la machine source." }, { status: 400 });
  }

  try {
    const jobId = cloneHostToNewMachine(sourceHostId, targetHostId);
    logAudit("host.clone_started", String(sourceHostId), `-> host ${targetHostId}`);
    return NextResponse.json({ jobId }, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 400 });
  }
}
