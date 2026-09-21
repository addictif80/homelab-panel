import { NextRequest, NextResponse } from "next/server";
import { getPlan } from "@/lib/backup/plans";
import { resurrectPlan } from "@/lib/backup/resurrect";
import { logAudit } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plan = getPlan(id);
  if (!plan) return NextResponse.json({ error: "Plan introuvable." }, { status: 404 });

  const { targetHostId } = (await req.json()) as { targetHostId?: number };
  if (!targetHostId) return NextResponse.json({ error: "Machine cible requise." }, { status: 400 });

  try {
    const jobId = resurrectPlan(id, targetHostId);
    logAudit("backup.resurrect_started", id, `-> host ${targetHostId}`);
    return NextResponse.json({ jobId }, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 400 });
  }
}
