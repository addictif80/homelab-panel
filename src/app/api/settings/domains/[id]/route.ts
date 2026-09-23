import { NextResponse } from "next/server";
import { removeWatchedRegDomain } from "@/lib/domainInfo";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  removeWatchedRegDomain(id);
  return NextResponse.json({ ok: true });
}
