import { NextRequest, NextResponse } from "next/server";
import { getRouterClient } from "@/lib/routers";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  try {
    const devices = await getRouterClient(Number(hostId)).listDevices();
    return NextResponse.json({ devices });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
