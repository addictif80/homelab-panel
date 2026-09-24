import { NextRequest, NextResponse } from "next/server";
import { pullAndRecreate } from "@/lib/docker";
import { logAudit } from "@/lib/db";
import { startJob, appendJobLog, finishJob } from "@/lib/jobs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ hostId: string; containerId: string }> }
) {
  const { hostId, containerId } = await params;
  const jobId = startJob("docker-container-recreate", `Recréation ${containerId}`, Number(hostId));

  pullAndRecreate(Number(hostId), containerId, (t) => appendJobLog(jobId, t))
    .then(() => {
      logAudit("docker.recreate", `${hostId}/${containerId}`);
      finishJob(jobId, "success");
    })
    .catch((err) => {
      appendJobLog(jobId, `\nErreur : ${err instanceof Error ? err.message : "Erreur Docker."}\n`);
      finishJob(jobId, "failed");
    });

  return NextResponse.json({ jobId });
}
