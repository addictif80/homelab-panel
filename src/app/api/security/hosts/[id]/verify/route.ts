import { NextRequest, NextResponse } from "next/server";
import { scanSingleHost } from "@/lib/security/scan";

/**
 * Re-scans one host and reports whether a specific finding is gone — used by the resolution
 * guide's "J'ai fait ça, vérifier" step for findings with no automatic fix (howTo-only), where
 * the user acted by hand on the machine and we just need to confirm it worked.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { findingId } = (await req.json()) as { findingId?: string };
  if (!findingId) {
    return NextResponse.json({ error: "Identifiant du problème manquant." }, { status: 400 });
  }

  try {
    const rescan = await scanSingleHost(Number(id));
    const stillPresent = rescan.findings.some((f) => f.id === findingId && !f.ignored);
    return NextResponse.json({ resolved: !stillPresent, rescan });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 400 });
  }
}
