import { NextRequest, NextResponse } from "next/server";
import { getReplication, setReplicationEnabled, removeReplication } from "@/lib/ha";
import { reconcileFolderReplicationsOnHost } from "@/lib/ha/folderReplication";
import { logAudit } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const replication = getReplication(id);
  if (!replication) return NextResponse.json({ error: "Réplication introuvable." }, { status: 404 });

  const { enabled } = (await req.json()) as { enabled?: boolean };
  if (enabled === undefined) return NextResponse.json({ error: "Rien à modifier." }, { status: 400 });

  setReplicationEnabled(id, enabled);
  // 'folder' is the only kind lsyncd actively runs — its config has to be regenerated the moment
  // a replication is toggled, or the source machine keeps pushing (or stops pushing) out of step
  // with what the panel now shows.
  if (replication.kind === "folder") {
    await reconcileFolderReplicationsOnHost(replication.sourceHostId).catch(() => {});
  }
  logAudit(enabled ? "ha.replication_enabled" : "ha.replication_disabled", id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const replication = getReplication(id);
  if (!replication) return NextResponse.json({ error: "Réplication introuvable." }, { status: 404 });

  await removeReplication(id);
  logAudit("ha.replication_removed", id, replication.name);
  return NextResponse.json({ ok: true });
}
