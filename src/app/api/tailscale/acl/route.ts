import { NextRequest, NextResponse } from "next/server";
import { getAcl, updateAcl } from "@/lib/tailscale";
import { logAudit } from "@/lib/db";

export async function GET() {
  try {
    const policy = await getAcl();
    return NextResponse.json({ policy });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const { policy } = (await req.json()) as { policy?: string };
  if (!policy) return NextResponse.json({ error: "Politique ACL requise." }, { status: 400 });
  try {
    await updateAcl(policy);
    logAudit("tailscale.acl_updated");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
