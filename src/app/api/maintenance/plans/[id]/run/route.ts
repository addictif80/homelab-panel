import { NextRequest, NextResponse } from "next/server";
import { runPlan, getLatestRunForPlan } from "@/lib/maintenance";
import { logAudit } from "@/lib/db";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const runId = runPlan(id);
    logAudit("maintenance.plan_run", id, runId);
    return NextResponse.json({ runId }, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 400 });
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ run: getLatestRunForPlan(id) });
}
