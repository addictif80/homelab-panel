import { NextRequest, NextResponse } from "next/server";
import { updateZone, deleteZone } from "@/lib/dns";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { label, config, secret } = (await req.json()) as {
    label?: string;
    config?: Record<string, string>;
    secret?: Record<string, string>;
  };
  try {
    updateZone(id, { label, config, secret });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deleteZone(id);
  return NextResponse.json({ ok: true });
}
