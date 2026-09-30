import { NextRequest, NextResponse } from "next/server";
import {
  getReplication,
  setReplicationEnabled,
  setReplicationFailoverLink,
  updateReplication,
  removeReplication,
  type UpdateReplicationInput,
} from "@/lib/ha";
import { reconcileFolderReplicationsOnHost } from "@/lib/ha/folderReplication";
import { logAudit } from "@/lib/db";

type PatchBody = UpdateReplicationInput & {
  enabled?: boolean;
  proxyHostId?: number | null;
  targetPort?: number | null;
};

const EDIT_FIELDS = [
  "name",
  "sourcePath",
  "targetPath",
  "dbPort",
  "dbUser",
  "dbPassword",
  "targetDbUser",
  "targetDbPassword",
  "targetOwner",
  "targetMode",
  "targetNeedsSudo",
  "syncScheduleTime",
  "appDbUser",
  "appDbPassword",
  "targetDbContainer",
  "sourceDbContainer",
] as const satisfies readonly (keyof UpdateReplicationInput)[];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const replication = getReplication(id);
  if (!replication) return NextResponse.json({ error: "Réplication introuvable." }, { status: 404 });

  const body = (await req.json()) as PatchBody;
  const { enabled, proxyHostId, targetPort } = body;
  const isDbKind = replication.kind === "mysql" || replication.kind === "postgres";
  const editedFields = EDIT_FIELDS.filter((f) => body[f] !== undefined);

  if (
    enabled === undefined &&
    proxyHostId === undefined &&
    targetPort === undefined &&
    editedFields.length === 0
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

  if (editedFields.length > 0) {
    // Native mysql/postgres replication can't rename a database in flight (see the create route's
    // own comment) — a new sourcePath keeps mirroring straight into targetPath here too, same as at
    // creation, instead of leaving the two to silently drift apart.
    const update: UpdateReplicationInput = {};
    for (const field of editedFields) (update as Record<string, unknown>)[field] = body[field];
    if (isDbKind && update.sourcePath !== undefined) update.targetPath = update.sourcePath;
    else if (isDbKind) delete update.targetPath;

    updateReplication(id, update);
    needsReconcile = true;
    logAudit("ha.replication_updated", id);
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
