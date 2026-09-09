import { NextRequest, NextResponse } from "next/server";
import { getNpmConfig, setNpmConfig, hasNpmPassword } from "@/lib/npm";

export async function GET() {
  return NextResponse.json({ config: getNpmConfig(), hasPassword: hasNpmPassword() });
}

export async function PUT(req: NextRequest) {
  const { baseUrl, email, password } = (await req.json()) as { baseUrl?: string; email?: string; password?: string };
  if (!baseUrl || !email) return NextResponse.json({ error: "URL et email requis." }, { status: 400 });
  setNpmConfig({ baseUrl, email }, password);
  return NextResponse.json({ ok: true });
}
