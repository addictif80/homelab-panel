import { NextResponse } from "next/server";
import { runBackupPlan } from "@/lib/backup/engine";
import { logAudit } from "@/lib/db";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const runId = await runBackupPlan(id);
    logAudit("backup.run_started", id, runId);
    return NextResponse.json({ runId }, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 400 });
  }
}
