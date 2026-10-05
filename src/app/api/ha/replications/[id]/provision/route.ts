import { NextRequest, NextResponse } from "next/server";
import { getReplication, updateReplicationStatus, runProvisioning } from "@/lib/ha";
import { logAudit } from "@/lib/db";

/** Re-runs just the web-server provisioning step (see lib/ha/provisioning.ts) without touching the
 * file sync itself — for after editing the vhost template/preset, or retrying a provisioning
 * command that failed the first time around. Never flips the replication to "error": the sync
 * already in place is untouched either way, only the appended status message changes. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const replication = getReplication(id);
  if (!replication) return NextResponse.json({ error: "Réplication introuvable." }, { status: 404 });
  if (!replication.provisionPreset) {
    return NextResponse.json({ error: "Aucun provisioning configuré pour cette réplication." }, { status: 400 });
  }

  const result = await runProvisioning(replication).catch((err) => ({
    ok: false,
    detail: err instanceof Error ? err.message : "Erreur inconnue lors du provisioning.",
  }));
  if (!result) {
    return NextResponse.json({ error: "Aucun provisioning configuré pour cette réplication." }, { status: 400 });
  }

  updateReplicationStatus(
    id,
    replication.status,
    result.ok ? "✓ Provisioning relancé avec succès." : `⚠ Provisioning échoué : ${result.detail}`
  );
  logAudit("ha.replication_provisioned", id, result.ok ? "ok" : "failed");
  return NextResponse.json({ ok: result.ok, detail: result.detail, replication: getReplication(id) });
}
