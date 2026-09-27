import { NextRequest, NextResponse } from "next/server";
import { getReplication, runReverseSync, reverseSyncSupported, isReplicationSetupRunning } from "@/lib/ha";
import { logAudit } from "@/lib/db";

/**
 * Manual fail-back action: overwrites the source with the target's current data (see
 * reverseSyncFolderReplication/reverseSyncMysqlReplication for exactly how). Always destructive to
 * the source, so always requires explicit confirmation — unlike the forward setup route, where only
 * 'postgres' needs it. Fires in the background the same way setup does; progress shows through the
 * replication's own status/statusDetail, polled by the UI.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const replication = getReplication(id);
  if (!replication) return NextResponse.json({ error: "Réplication introuvable." }, { status: 404 });

  if (!reverseSyncSupported(replication.kind)) {
    return NextResponse.json(
      { error: `La resynchronisation manuelle n'est pas encore disponible pour le type "${replication.kind}".` },
      { status: 400 }
    );
  }
  if (isReplicationSetupRunning(id)) {
    return NextResponse.json({ error: "Une opération est déjà en cours pour cette réplication." }, { status: 409 });
  }

  const { confirmed } = (await req.json().catch(() => ({}))) as { confirmed?: boolean };
  if (!confirmed) {
    return NextResponse.json(
      {
        error:
          "Ceci va écraser le contenu actuel de la machine source avec celui de la machine cible — confirmation requise.",
        requiresConfirmation: true,
      },
      { status: 409 }
    );
  }

  logAudit("ha.replication_reverse_sync_started", id, replication.kind);
  runReverseSync(id).catch(() => {
    // Already recorded on the replication's own status/statusDetail by runReverseSync itself.
  });
  return NextResponse.json({ ok: true });
}
