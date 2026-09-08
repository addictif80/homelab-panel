import { NextRequest, NextResponse } from "next/server";
import { listResources } from "@/lib/proxmox";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  try {
    const resources = await listResources(Number(hostId));
    return NextResponse.json({ resources });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur Proxmox." },
      { status: 502 }
    );
  }
}
