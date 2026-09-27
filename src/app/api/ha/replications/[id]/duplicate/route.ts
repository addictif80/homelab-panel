import { NextRequest, NextResponse } from "next/server";
import { duplicateReplication } from "@/lib/ha";
import { logAudit } from "@/lib/db";

/** Copies an existing replication's settings into a brand new one (see duplicateReplication's own
 * doc comment for exactly what is and isn't carried over) — the new row is unconfigured until the
 * user edits whatever needs to differ (name, path/database, owner...) and clicks "Configurer". */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const duplicate = duplicateReplication(id);
  if (!duplicate) return NextResponse.json({ error: "Réplication introuvable." }, { status: 404 });

  logAudit("ha.replication_duplicated", duplicate.id, `depuis ${id}`);
  return NextResponse.json({ replication: duplicate });
}
