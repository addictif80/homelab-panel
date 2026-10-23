import { NextRequest, NextResponse } from "next/server";
import { applyDnsServersToAllHosts, getDefaultDnsServers, validateDnsServers } from "@/lib/dns/resolver";
import { logAudit } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ servers: getDefaultDnsServers() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { servers?: unknown };
  let servers: string[];
  try {
    servers = validateDnsServers(body.servers);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 400 });
  }

  const result = await applyDnsServersToAllHosts(servers);
  logAudit("hosts.dns_applied_all", undefined, `${result.applied} appliqué(s), ${result.failed.length} échec(s)`);
  return NextResponse.json(result);
}
