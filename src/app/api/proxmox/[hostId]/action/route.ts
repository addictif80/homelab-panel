import { NextRequest, NextResponse } from "next/server";
import { vmAction } from "@/lib/proxmox";
import { logAudit } from "@/lib/db";

const ALLOWED_ACTIONS = ["start", "stop", "shutdown", "reboot"] as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  const { node, type, vmid, action } = await req.json();

  if (!node || !["qemu", "lxc"].includes(type) || !vmid || !ALLOWED_ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  }

  try {
    await vmAction(Number(hostId), node, type, Number(vmid), action);
    logAudit("proxmox.vm_action", `${node}/${type}/${vmid}`, action);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur Proxmox." },
      { status: 502 }
    );
  }
}
