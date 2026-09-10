import { NextRequest, NextResponse } from "next/server";
import { listWebsites, createWebsite, deleteWebsite } from "@/lib/cyberpanel";
import { logAudit } from "@/lib/db";

export async function GET() {
  try {
    const websites = await listWebsites();
    return NextResponse.json({ websites });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { domain?: string; username?: string; password?: string; email?: string; packageName?: string };
  if (!body.domain || !body.username || !body.password || !body.email) {
    return NextResponse.json({ error: "Domaine, utilisateur, mot de passe et email requis." }, { status: 400 });
  }
  try {
    await createWebsite({
      domain: body.domain,
      username: body.username,
      password: body.password,
      email: body.email,
      packageName: body.packageName,
    });
    logAudit("cyberpanel.website_created", body.domain);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get("domain");
  if (!domain) return NextResponse.json({ error: "Domaine requis." }, { status: 400 });
  try {
    await deleteWebsite(domain);
    logAudit("cyberpanel.website_deleted", domain);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
