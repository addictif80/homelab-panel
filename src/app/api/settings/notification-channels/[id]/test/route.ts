import { NextRequest, NextResponse } from "next/server";
import { testChannel } from "@/lib/notifications/channels";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await testChannel(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Échec de l'envoi." }, { status: 400 });
  }
}
