import { NextRequest, NextResponse } from "next/server";
import {
  getReplication,
  setReplicationEnabled,
  setReplicationFailoverLink,
  setReplicationTargetOptions,
  removeReplication,
} from "@/lib/ha";
import { reconcileFolderReplicationsOnHost } from "@/lib/ha/folderReplication";
import { logAudit } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const replication = getReplication(id);
  if (!replication) return NextResponse.json({ error: "Réplication introuvable." }, { status: 404 });

  const { enabled, proxyHostId, targetPort, targetOwner, targetMode, targetNeedsSudo } = (await req.json()) as {
    enabled?: boolean;
    proxyHostId?: number | null;
    targetPort?: number | null;
    targetOwner?: string | null;
    targetMode?: string | null;
    targetNeedsSudo?: boolean;
  };
  if (
    enabled === undefined &&
    proxyHostId === undefined &&
    targetPort === undefined &&
    targetOwner === undefined &&
    targetMode === undefined &&
    targetNeedsSudo === undefined
  ) {
    return NextResponse.json({ error: "Rien à modifier." }, { status: 400 });
  }

  // 'folder' is the only kind lsyncd actively runs — its config has to be regenerated any time one
  // of these settings changes, or the source machine keeps running out of step with what the panel
  // now shows (still pushing after being disabled, still hitting Permission denied after the sudo
  // option was just turned on...).
  let needsReconcile = false;

  if (enabled !== undefined) {
    setReplicationEnabled(id, enabled);
    needsReconcile = true;
    logAudit(enabled ? "ha.replication_enabled" : "ha.replication_disabled", id);
  }

  if (targetOwner !== undefined || targetMode !== undefined || targetNeedsSudo !== undefined) {
    setReplicationTargetOptions(id, { targetOwner, targetMode, targetNeedsSudo });
    needsReconcile = true;
    logAudit("ha.replication_target_options_updated", id);
  }

  if (needsReconcile && replication.kind === "folder") {
    await reconcileFolderReplicationsOnHost(replication.sourceHostId).catch(() => {});
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
