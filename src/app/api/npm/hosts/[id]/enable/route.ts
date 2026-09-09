import { NextRequest, NextResponse } from "next/server";
import { setProxyHostEnabled } from "@/lib/npm";
import { logAudit } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { enabled } = (await req.json()) as { enabled: boolean };
  try {
    await setProxyHostEnabled(Number(id), enabled);
    logAudit("npm.host_toggled", id, String(enabled));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
