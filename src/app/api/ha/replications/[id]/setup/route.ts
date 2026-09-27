import { NextRequest, NextResponse } from "next/server";
import { getReplication, runReplicationSetup, replicationSetupIsDestructive, isReplicationSetupRunning } from "@/lib/ha";
import { logAudit } from "@/lib/db";

/**
 * Fires the (potentially multi-minute) setup off in the background and returns immediately —
 * progress is visible through the replication's own `status`/`statusDetail` fields, updated at
 * each step by the setup functions themselves, which the UI polls via GET /api/ha/replications
 * the same way update jobs and backup runs already work elsewhere in this panel.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const replication = getReplication(id);
  if (!replication) return NextResponse.json({ error: "Réplication introuvable." }, { status: 404 });
  // A second click (double-click, a reload while the first request's fire-and-forget setup is
  // still running server-side, a slow first attempt that looked stuck) would otherwise start a
  // *second* overlapping setup for the same replication — two runs racing to dump/wipe/restore the
  // same target tables, which surfaces as confusing "table already exists" failures unrelated to
  // whatever's actually being configured.
  if (isReplicationSetupRunning(id)) {
    return NextResponse.json({ error: "Une configuration est déjà en cours pour cette réplication." }, { status: 409 });
  }

  const { confirmed } = (await req.json().catch(() => ({}))) as { confirmed?: boolean };
  if (replicationSetupIsDestructive(replication.kind) && !confirmed) {
    return NextResponse.json(
      {
        error:
          "Cette configuration efface le contenu actuel de la base sur la machine cible avant la synchronisation initiale — confirmation requise.",
        requiresConfirmation: true,
      },
      { status: 409 }
    );
  }

  logAudit("ha.replication_setup_started", id, replication.kind);
  runReplicationSetup(id).catch(() => {
    // Already recorded on the replication's own status/statusDetail by runReplicationSetup itself
    // — nothing else to do with the rejection here since the HTTP response has already gone out.
  });
  return NextResponse.json({ ok: true });
}
