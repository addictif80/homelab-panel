import { NextRequest, NextResponse } from "next/server";
import { getSelfUpdateJob } from "@/lib/selfUpdate";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getSelfUpdateJob(id);
  if (!job) return NextResponse.json({ error: "Tâche introuvable." }, { status: 404 });
  return NextResponse.json({ job });
}
