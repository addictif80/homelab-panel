import { NextRequest, NextResponse } from "next/server";
import { getReplication, checkReplicationStatus } from "@/lib/ha";

/** Manual "vérifier/synchroniser maintenant" — for 'sqlite' this actually triggers the next
 * snapshot-and-copy (there's no continuous mechanism to just check on), for the other kinds it
 * only refreshes the displayed status. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getReplication(id)) return NextResponse.json({ error: "Réplication introuvable." }, { status: 404 });

  await checkReplicationStatus(id);
  return NextResponse.json({ replication: getReplication(id) });
}
