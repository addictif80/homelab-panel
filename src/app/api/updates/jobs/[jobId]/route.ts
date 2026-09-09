import { NextRequest, NextResponse } from "next/server";
import { getUpdateJob } from "@/lib/updates";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getUpdateJob(jobId);
  if (!job) return NextResponse.json({ error: "Tâche introuvable." }, { status: 404 });
  return NextResponse.json({ job });
}
