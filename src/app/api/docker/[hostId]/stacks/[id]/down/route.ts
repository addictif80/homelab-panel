import { NextResponse } from "next/server";
import { bringStackDown, getStack } from "@/lib/dockerStacks";
import { startJob, appendJobLog, finishJob } from "@/lib/jobs";

export async function POST(_req: Request, { params }: { params: Promise<{ hostId: string; id: string }> }) {
  const { hostId, id } = await params;
  const stack = getStack(id);
  const jobId = startJob("docker-stack-down", `Arrêt ${stack?.name ?? id}`, Number(hostId));

  bringStackDown(id, (t) => appendJobLog(jobId, t))
    .then(() => finishJob(jobId, "success"))
    .catch((err) => {
      appendJobLog(jobId, `\nErreur : ${err instanceof Error ? err.message : "Erreur."}\n`);
      finishJob(jobId, "failed");
    });

  return NextResponse.json({ jobId });
}
