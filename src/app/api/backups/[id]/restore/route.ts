import { NextRequest, NextResponse } from "next/server";
import { getPlan } from "@/lib/backup/plans";
import { restoreSnapshotPath } from "@/lib/backup/restore";
import { logAudit } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plan = getPlan(id);
  if (!plan) return NextResponse.json({ error: "Plan introuvable." }, { status: 404 });

  const { snapshotDir, path, targetHostId, targetParentDir } = (await req.json()) as {
    snapshotDir?: string;
    path?: string;
    targetHostId?: number;
    targetParentDir?: string;
  };
  if (!snapshotDir || !path || !targetHostId) {
    return NextResponse.json({ error: "Snapshot, chemin et machine cible requis." }, { status: 400 });
  }

  const runId = restoreSnapshotPath(id, plan.destHostId, snapshotDir, path, targetHostId, targetParentDir);
  logAudit("backup.restore_started", id, `${snapshotDir}${path} -> host ${targetHostId}`);
  return NextResponse.json({ runId }, { status: 202 });
}
