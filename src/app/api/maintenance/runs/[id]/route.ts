import { NextRequest, NextResponse } from "next/server";
import { getRun } from "@/lib/maintenance";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: "Exécution introuvable." }, { status: 404 });
  return NextResponse.json({ run });
}
