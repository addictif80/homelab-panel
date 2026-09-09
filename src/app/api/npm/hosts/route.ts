import { NextRequest, NextResponse } from "next/server";
import { createProxyHost, listProxyHosts, type ProxyHostInput } from "@/lib/npm";
import { logAudit } from "@/lib/db";

export async function GET() {
  try {
    const hosts = await listProxyHosts();
    return NextResponse.json({ hosts });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ProxyHostInput;
  if (!body.domainNames?.length || !body.forwardHost || !body.forwardPort) {
    return NextResponse.json({ error: "Domaine, hôte et port cible requis." }, { status: 400 });
  }
  try {
    const host = await createProxyHost(body);
    logAudit("npm.host_created", String(host.id), body.domainNames.join(", "));
    return NextResponse.json({ host }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
