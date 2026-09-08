import { NextRequest, NextResponse } from "next/server";
import { containerLogs } from "@/lib/docker";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ hostId: string; containerId: string }> }
) {
  const { hostId, containerId } = await params;
  const tail = Number(req.nextUrl.searchParams.get("tail") || 200);
  try {
    const logs = await containerLogs(Number(hostId), containerId, tail);
    return NextResponse.json({ logs });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur Docker." }, { status: 502 });
  }
}
