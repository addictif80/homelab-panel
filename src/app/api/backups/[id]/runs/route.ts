import { NextResponse } from "next/server";
import { listRuns } from "@/lib/backup/runs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ runs: listRuns(id) });
}
