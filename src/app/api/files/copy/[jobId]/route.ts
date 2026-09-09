import { NextResponse } from "next/server";
import { getCopyJob } from "@/lib/fileCopy";

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getCopyJob(jobId);
  if (!job) return NextResponse.json({ error: "Job introuvable." }, { status: 404 });
  return NextResponse.json({ job });
}
