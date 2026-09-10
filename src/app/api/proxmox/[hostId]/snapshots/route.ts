import { NextRequest, NextResponse } from "next/server";
import { listSnapshots, createSnapshot } from "@/lib/proxmox";
import { logAudit } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  const { searchParams } = req.nextUrl;
  const node = searchParams.get("node");
  const type = searchParams.get("type") as "qemu" | "lxc" | null;
  const vmid = searchParams.get("vmid");

  if (!node || !type || !["qemu", "lxc"].includes(type) || !vmid) {
    return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  }

  try {
    const snapshots = await listSnapshots(Number(hostId), node, type, Number(vmid));
    return NextResponse.json({ snapshots });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur Proxmox." },
      { status: 502 }
    );
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  const { node, type, vmid, name, description, includeRamState } = await req.json();

  if (!node || !["qemu", "lxc"].includes(type) || !vmid || !name) {
    return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  }

  try {
    await createSnapshot(Number(hostId), node, type, Number(vmid), name, description, !!includeRamState);
    logAudit("proxmox.snapshot_create", `${node}/${type}/${vmid}`, name);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur Proxmox." },
      { status: 502 }
    );
  }
}
