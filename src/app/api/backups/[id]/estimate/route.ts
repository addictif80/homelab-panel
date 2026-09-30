import { NextResponse } from "next/server";
import { getPlan } from "@/lib/backup/plans";
import { estimateBackupDuration } from "@/lib/backup/estimate";

/**
 * On-demand only — deliberately not something the plan list fetches automatically for every plan
 * on every page load. It runs `du -sb` against the plan's real source paths (and, for a docker
 * plan, a `docker inspect` first to resolve them), real disk activity on a source host that may
 * already be under strain, which is exactly the scenario this estimate exists to help avoid
 * making worse.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plan = getPlan(id);
  if (!plan) return NextResponse.json({ error: "Plan introuvable." }, { status: 404 });

  try {
    const estimate = await estimateBackupDuration(plan);
    return NextResponse.json({ estimate });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Estimation impossible." }, { status: 500 });
  }
}
