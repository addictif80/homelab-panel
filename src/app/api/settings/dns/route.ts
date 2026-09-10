import { NextRequest, NextResponse } from "next/server";
import { getDnsConfig, setDnsConfig, hasDnsToken } from "@/lib/dns";

export async function GET() {
  return NextResponse.json({ config: getDnsConfig(), hasToken: hasDnsToken() });
}

export async function PUT(req: NextRequest) {
  const { zoneId, zoneName, token } = (await req.json()) as {
    zoneId?: string;
    zoneName?: string;
    token?: string;
  };
  if (!zoneId || !zoneName) return NextResponse.json({ error: "Zone ID et nom de domaine requis." }, { status: 400 });
  setDnsConfig({ zoneId, zoneName }, token);
  return NextResponse.json({ ok: true });
}
