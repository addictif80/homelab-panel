import { NextResponse } from "next/server";
import { getRun } from "@/lib/backup/runs";

export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = getRun(runId);
  if (!run) return NextResponse.json({ error: "Sauvegarde introuvable." }, { status: 404 });
  return NextResponse.json({ run });
}
