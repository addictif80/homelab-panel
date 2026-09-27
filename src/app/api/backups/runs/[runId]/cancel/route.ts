import { NextResponse } from "next/server";
import { getRun } from "@/lib/backup/runs";
import { cancelBackupRun } from "@/lib/backup/engine";
import { logAudit } from "@/lib/db";

/** Best-effort: closes the SSH connection the run's transfer is using, which reliably kills
 * whatever rsync/mysqldump/etc. was reading from or writing to it — see cancelBackupRun's own doc
 * comment. A no-op if the run already finished by the time this arrives, not an error. */
export async function POST(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = getRun(runId);
  if (!run) return NextResponse.json({ error: "Sauvegarde introuvable." }, { status: 404 });
  if (run.status !== "running") return NextResponse.json({ ok: true });

  cancelBackupRun(runId);
  logAudit("backup.run_cancelled", runId);
  return NextResponse.json({ ok: true });
}
