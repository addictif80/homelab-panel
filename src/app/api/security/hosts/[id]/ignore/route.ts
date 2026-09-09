import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/db";
import { ignoreFinding, unignoreFinding } from "@/lib/security/ignore";

// Toggling "ignore" is purely local bookkeeping (no need to re-run the SSH-based scan) —
// the frontend flips the finding's ignored flag itself once this succeeds.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hostId = Number(id);
  const { findingId, ignore } = (await req.json()) as { findingId?: string; ignore?: boolean };
  if (!findingId) {
    return NextResponse.json({ error: "Identifiant du problème manquant." }, { status: 400 });
  }

  if (ignore === false) {
    unignoreFinding(hostId, findingId);
    logAudit("security.unignore", String(hostId), findingId);
  } else {
    ignoreFinding(hostId, findingId);
    logAudit("security.ignore", String(hostId), findingId);
  }

  return NextResponse.json({ ok: true });
}
