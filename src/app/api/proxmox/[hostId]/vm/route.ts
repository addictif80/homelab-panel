import { NextRequest, NextResponse } from "next/server";
import { getVmConfig, createVm, type CreateVmInput } from "@/lib/proxmox";
import { logAudit } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  const node = req.nextUrl.searchParams.get("node");
  const type = req.nextUrl.searchParams.get("type");
  const vmid = req.nextUrl.searchParams.get("vmid");
  if (!node || (type !== "qemu" && type !== "lxc") || !vmid) {
    return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  }
  try {
    const config = await getVmConfig(Number(hostId), node, type, Number(vmid));
    return NextResponse.json({ config });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur Proxmox." }, { status: 502 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  const body = (await req.json()) as { node?: string } & Partial<CreateVmInput>;
  const { node, vmid, name, cores, memoryMb, diskSpec, bridge, isoSpec } = body;

  if (!node || !vmid || !name || !cores || !memoryMb || !diskSpec || !bridge) {
    return NextResponse.json({ error: "Champs requis manquants." }, { status: 400 });
  }

  try {
    await createVm(Number(hostId), node, { vmid, name, cores, memoryMb, diskSpec, bridge, isoSpec });
    logAudit("proxmox.vm_created", `${node}/qemu/${vmid}`, name);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur Proxmox." }, { status: 502 });
  }
}
