import { NextRequest, NextResponse } from "next/server";
import { getResurrection } from "@/lib/backup/resurrect";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getResurrection(id);
  if (!job) return NextResponse.json({ error: "Introuvable." }, { status: 404 });
  return NextResponse.json(job);
}
