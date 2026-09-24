import { NextRequest, NextResponse } from "next/server";
import { getReplication, setReplicationEnabled, setReplicationFailoverLink, removeReplication } from "@/lib/ha";
import { reconcileFolderReplicationsOnHost } from "@/lib/ha/folderReplication";
import { logAudit } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const replication = getReplication(id);
  if (!replication) return NextResponse.json({ error: "Réplication introuvable." }, { status: 404 });

  const { enabled, proxyHostId, targetPort } = (await req.json()) as {
    enabled?: boolean;
    proxyHostId?: number | null;
    targetPort?: number | null;
  };
  if (enabled === undefined && proxyHostId === undefined && targetPort === undefined) {
    return NextResponse.json({ error: "Rien à modifier." }, { status: 400 });
  }

  if (enabled !== undefined) {
    setReplicationEnabled(id, enabled);
    // 'folder' is the only kind lsyncd actively runs — its config has to be regenerated the moment
    // a replication is toggled, or the source machine keeps pushing (or stops pushing) out of step
    // with what the panel now shows.
    if (replication.kind === "folder") {
      await reconcileFolderReplicationsOnHost(replication.sourceHostId).catch(() => {});
    }
    logAudit(enabled ? "ha.replication_enabled" : "ha.replication_disabled", id);
  }

  if (proxyHostId !== undefined || targetPort !== undefined) {
    setReplicationFailoverLink(
      id,
      proxyHostId !== undefined ? proxyHostId : replication.proxyHostId,
      targetPort !== undefined ? targetPort : replication.targetPort
    );
    logAudit("ha.replication_failover_link_updated", id);
  }

  return NextResponse.json({ ok: true, replication: getReplication(id) });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const replication = getReplication(id);
  if (!replication) return NextResponse.json({ error: "Réplication introuvable." }, { status: 404 });

  await removeReplication(id);
  logAudit("ha.replication_removed", id, replication.name);
  return NextResponse.json({ ok: true });
}
