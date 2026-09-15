import { NextResponse } from "next/server";
import { getMigrationJob } from "@/lib/migrationJobs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getMigrationJob(id);
  if (!job) return NextResponse.json({ error: "Tâche introuvable." }, { status: 404 });
  return NextResponse.json({ job });
}
