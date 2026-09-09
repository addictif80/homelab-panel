import { NextRequest, NextResponse } from "next/server";
import { getSmtpConfig, setSmtpConfig, hasSmtpPassword, type SmtpConfig } from "@/lib/mail";

export async function GET() {
  const config = getSmtpConfig();
  return NextResponse.json({ config, hasPassword: hasSmtpPassword() });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as SmtpConfig & { password?: string };
  const { host, port, secure, user, from, to, enabled, password } = body;

  if (!host || !port || !from || !to) {
    return NextResponse.json({ error: "Hôte, port, expéditeur et destinataire sont requis." }, { status: 400 });
  }

  setSmtpConfig({ host, port: Number(port), secure: !!secure, user: user || "", from, to, enabled: !!enabled }, password);
  return NextResponse.json({ ok: true });
}
