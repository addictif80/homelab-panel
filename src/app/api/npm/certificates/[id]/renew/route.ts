import { NextRequest, NextResponse } from "next/server";
import { renewCertificate } from "@/lib/npm";
import { logAudit } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await renewCertificate(Number(id));
    logAudit("npm.certificate_renew", id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur NPM." },
      { status: 502 }
    );
  }
}
