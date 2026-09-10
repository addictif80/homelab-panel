import { NextRequest, NextResponse } from "next/server";
import { getRouterClient } from "@/lib/routers";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  try {
    const status = await getRouterClient(Number(hostId)).getStatus();
    return NextResponse.json({ status });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
