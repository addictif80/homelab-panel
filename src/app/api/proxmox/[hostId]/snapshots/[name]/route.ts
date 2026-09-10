import { NextRequest, NextResponse } from "next/server";
import { rollbackSnapshot, deleteSnapshot } from "@/lib/proxmox";
import { logAudit } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ hostId: string; name: string }> }) {
  const { hostId, name } = await params;
  const { node, type, vmid, action } = await req.json();

  if (!node || !["qemu", "lxc"].includes(type) || !vmid || action !== "rollback") {
    return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  }

  try {
    await rollbackSnapshot(Number(hostId), node, type, Number(vmid), name);
    logAudit("proxmox.snapshot_rollback", `${node}/${type}/${vmid}`, name);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur Proxmox." },
      { status: 502 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ hostId: string; name: string }> }) {
  const { hostId, name } = await params;
  const { searchParams } = req.nextUrl;
  const node = searchParams.get("node");
  const type = searchParams.get("type") as "qemu" | "lxc" | null;
  const vmid = searchParams.get("vmid");

  if (!node || !type || !["qemu", "lxc"].includes(type) || !vmid) {
    return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  }

  try {
    await deleteSnapshot(Number(hostId), node, type, Number(vmid), name);
    logAudit("proxmox.snapshot_delete", `${node}/${type}/${vmid}`, name);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur Proxmox." },
      { status: 502 }
    );
  }
}
