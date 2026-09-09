import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/db";
import { applySecurityFix } from "@/lib/security/fixes";
import { scanSingleHost } from "@/lib/security/scan";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hostId = Number(id);
  const { fixId } = (await req.json()) as { fixId?: string };
  if (!fixId) {
    return NextResponse.json({ error: "Correctif manquant." }, { status: 400 });
  }

  try {
    const result = await applySecurityFix(hostId, fixId);
    logAudit("security.fix", String(hostId), fixId);
    const rescan = await scanSingleHost(hostId);
    return NextResponse.json({ result, rescan });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Échec du correctif." }, { status: 400 });
  }
}
