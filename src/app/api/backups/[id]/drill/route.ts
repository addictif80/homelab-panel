import { NextResponse } from "next/server";
import { getPlan } from "@/lib/backup/plans";
import { runRestoreDrill, getLatestDrill } from "@/lib/backup/drill";
import { logAudit } from "@/lib/db";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plan = getPlan(id);
  if (!plan) return NextResponse.json({ error: "Plan introuvable." }, { status: 404 });

  try {
    const drillId = runRestoreDrill(id);
    logAudit("backup.drill_started", id);
    return NextResponse.json({ drillId }, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 400 });
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ drill: getLatestDrill(id) });
}
