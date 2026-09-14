import { NextResponse } from "next/server";
import { getRun } from "@/lib/backup/runs";
import { getPlan } from "@/lib/backup/plans";
import { joinRemote } from "@/lib/backup/engine";
import { runSshCommand, shellQuote } from "@/lib/ssh";
import { restoreConfigSnapshot, type ConfigSnapshot } from "@/lib/recoveryVault";
import { logAudit } from "@/lib/db";

/**
 * A "panel_config" backup's whole point is that it CAN be re-imported mechanically (unlike a
 * Proxmox vzdump or a SQL dump, which need a human to run qmrestore/psql afterwards) — reads the
 * snapshot straight off the backup destination host over SSH and applies it directly, no local
 * download/upload round-trip needed.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = getRun(runId);
  if (!run || !run.snapshotPath) return NextResponse.json({ error: "Sauvegarde introuvable." }, { status: 404 });
  if (run.status !== "success") return NextResponse.json({ error: "Cette sauvegarde n'a pas réussi." }, { status: 400 });

  const plan = getPlan(run.planId);
  if (!plan || plan.sourceType !== "panel_config") {
    return NextResponse.json({ error: "Cette sauvegarde n'est pas une configuration du panel." }, { status: 400 });
  }
  const jsonPath = run.paths[0];
  if (!jsonPath) return NextResponse.json({ error: "Chemin de l'instantané introuvable." }, { status: 400 });

  const remoteFile = joinRemote(run.snapshotPath, jsonPath);
  const { code, stdout, stderr } = await runSshCommand(plan.destHostId, `cat ${shellQuote(remoteFile)}`);
  if (code !== 0) {
    return NextResponse.json({ error: stderr.trim() || "Impossible de lire l'instantané." }, { status: 502 });
  }

  let snapshot: ConfigSnapshot;
  try {
    snapshot = JSON.parse(stdout);
  } catch {
    return NextResponse.json({ error: "Instantané illisible (JSON invalide)." }, { status: 502 });
  }

  const summary = restoreConfigSnapshot(snapshot);
  logAudit("backup.panel_config_imported", runId, `${summary.reduce((n, s) => n + s.rows, 0)} lignes restaurées`);
  return NextResponse.json({ summary });
}
