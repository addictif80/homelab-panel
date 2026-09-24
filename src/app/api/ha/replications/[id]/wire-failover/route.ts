import { NextRequest, NextResponse } from "next/server";
import { getReplication, wireFailoverForReplication } from "@/lib/ha";
import { logAudit } from "@/lib/db";

/** Re-applies the failover link on demand — e.g. after the linked NPM host or the target's IP
 * changed, without having to rerun the whole (potentially destructive, for postgres) replication
 * setup just to refresh this one piece. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const replication = getReplication(id);
  if (!replication) return NextResponse.json({ error: "Réplication introuvable." }, { status: 404 });
  if (!replication.proxyHostId) {
    return NextResponse.json({ error: "Aucun hôte NPM associé à cette réplication." }, { status: 400 });
  }

  try {
    await wireFailoverForReplication(replication);
    logAudit("ha.replication_failover_wired", id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
