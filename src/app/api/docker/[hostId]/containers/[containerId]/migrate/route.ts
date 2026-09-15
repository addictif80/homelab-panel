import { NextRequest, NextResponse } from "next/server";
import { startDockerMigrationJob } from "@/lib/migrationJobs";
import { logAudit } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ hostId: string; containerId: string }> }) {
  const { hostId, containerId } = await params;
  const { destHostId, removeSource } = (await req.json().catch(() => ({}))) as {
    destHostId?: number;
    removeSource?: boolean;
  };
  if (!destHostId) return NextResponse.json({ error: "Machine de destination requise." }, { status: 400 });
  if (destHostId === Number(hostId)) {
    return NextResponse.json({ error: "La destination doit être différente de la source." }, { status: 400 });
  }

  const jobId = startDockerMigrationJob(Number(hostId), containerId, destHostId, !!removeSource);
  logAudit("docker.migration_started", containerId, `vers l'hôte ${destHostId}`);
  return NextResponse.json({ jobId });
}
