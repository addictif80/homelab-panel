import { NextRequest, NextResponse } from "next/server";
import { listContainers } from "@/lib/docker";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  try {
    const containers = await listContainers(Number(hostId));
    return NextResponse.json({ containers });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur Docker." }, { status: 502 });
  }
}
