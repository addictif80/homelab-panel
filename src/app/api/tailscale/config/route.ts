import { NextRequest, NextResponse } from "next/server";
import { getTailscaleConfig, setTailscaleConfig } from "@/lib/tailscale";
import { logAudit } from "@/lib/db";

export async function GET() {
  const config = getTailscaleConfig();
  return NextResponse.json({ configured: !!config, tailnet: config?.tailnet ?? null });
}

export async function POST(req: NextRequest) {
  const { apiKey, tailnet } = await req.json();
  if (!apiKey || !tailnet) {
    return NextResponse.json({ error: "Clé API et tailnet requis." }, { status: 400 });
  }
  setTailscaleConfig({ apiKey, tailnet });
  logAudit("tailscale.configured");
  return NextResponse.json({ ok: true });
}
