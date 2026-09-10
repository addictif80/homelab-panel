import { NextRequest, NextResponse } from "next/server";
import { checkForUpdates } from "@/lib/docker";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  try {
    const statuses = await checkForUpdates(Number(hostId));
    return NextResponse.json({ statuses });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur Docker." }, { status: 502 });
  }
}
