import { NextRequest, NextResponse } from "next/server";
import { getHostDnsServers, setHostDnsServers, validateDnsServers } from "@/lib/dns/resolver";
import { logAudit } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const servers = await getHostDnsServers(Number(id));
  return NextResponse.json({ servers });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as { servers?: unknown };
  let servers: string[];
  try {
    servers = validateDnsServers(body.servers);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 400 });
  }

  try {
    await setHostDnsServers(Number(id), servers);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
  logAudit("hosts.dns_updated", id, servers.join(", "));
  return NextResponse.json({ ok: true, servers });
}
