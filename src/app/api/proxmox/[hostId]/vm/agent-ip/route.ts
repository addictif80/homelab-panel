import { NextRequest, NextResponse } from "next/server";
import { getVmAgentIps } from "@/lib/proxmox";

/** Used by the Proxmox page to decide whether a VM (as opposed to an LXC, which always gets a
 * Terminal button via `pct exec`) can offer one-click SSH — only when the QEMU guest agent
 * reports an IP that matches an already-configured host. See lib/proxmox.ts's getVmAgentIps for
 * why there's no equivalent of `pct exec` for a fully isolated VM. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  const node = req.nextUrl.searchParams.get("node");
  const vmid = req.nextUrl.searchParams.get("vmid");
  if (!node || !vmid) return NextResponse.json({ error: "node et vmid requis." }, { status: 400 });

  const ips = await getVmAgentIps(Number(hostId), node, Number(vmid));
  return NextResponse.json({ ips });
}
