import { NextRequest, NextResponse } from "next/server";
import { auditAllHosts, auditHostPorts } from "@/lib/security/portAudit";
import { logAudit } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { hostId } = (await req.json().catch(() => ({}))) as { hostId?: number };

  const findings = hostId ? await auditHostPorts(hostId) : await auditAllHosts();
  logAudit("security.port_audit", hostId ? String(hostId) : "all", `${findings.length} port(s) exposé(s)`);
  return NextResponse.json({ findings });
}
