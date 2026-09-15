import { NextRequest, NextResponse } from "next/server";
import { startVmMigrationJob } from "@/lib/migrationJobs";
import { logAudit } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    node?: string;
    type?: "qemu" | "lxc";
    vmid?: number;
    destHostId?: number;
    destNode?: string;
    newVmid?: number;
    storage?: string;
    online?: boolean;
  };

  if (!body.node || !body.type || !body.vmid || !body.destHostId || !body.destNode) {
    return NextResponse.json({ error: "Nœud source, type, VMID, hôte et nœud de destination requis." }, { status: 400 });
  }

  const jobId = startVmMigrationJob(Number(hostId), body.node, body.type, body.vmid, body.destHostId, body.destNode, {
    newVmid: body.newVmid,
    storage: body.storage,
    online: body.online,
  });
  logAudit("proxmox.migration_started", String(body.vmid), `vers ${body.destNode}`);
  return NextResponse.json({ jobId });
}
