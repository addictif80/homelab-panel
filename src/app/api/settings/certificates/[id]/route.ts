import { NextResponse } from "next/server";
import { removeWatchedDomain } from "@/lib/certWatch";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  removeWatchedDomain(id);
  return NextResponse.json({ ok: true });
}
