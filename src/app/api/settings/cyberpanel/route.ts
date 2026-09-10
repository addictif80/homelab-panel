import { NextRequest, NextResponse } from "next/server";
import { getCyberPanelConfig, setCyberPanelConfig, hasCyberPanelPassword, testCyberPanelConnection } from "@/lib/cyberpanel";

export async function GET() {
  return NextResponse.json({ config: getCyberPanelConfig(), hasPassword: hasCyberPanelPassword() });
}

export async function PUT(req: NextRequest) {
  const { baseUrl, adminUser, password, verifySsl } = (await req.json()) as {
    baseUrl?: string;
    adminUser?: string;
    password?: string;
    verifySsl?: boolean;
  };
  if (!baseUrl || !adminUser) {
    return NextResponse.json({ error: "URL et utilisateur admin requis." }, { status: 400 });
  }
  setCyberPanelConfig({ baseUrl, adminUser, verifySsl: !!verifySsl }, password);

  try {
    await testCyberPanelConnection();
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Connexion échouée." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
