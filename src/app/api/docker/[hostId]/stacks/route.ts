import { NextRequest, NextResponse } from "next/server";
import { listStacks, createAndDeployStack } from "@/lib/dockerStacks";
import { startJob, appendJobLog, finishJob } from "@/lib/jobs";

export async function GET(_req: Request, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  return NextResponse.json({ stacks: listStacks(Number(hostId)) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  const { name, composeContent } = (await req.json().catch(() => ({}))) as { name?: string; composeContent?: string };
  if (!name?.trim()) return NextResponse.json({ error: "Nom requis." }, { status: 400 });
  if (!composeContent?.trim()) return NextResponse.json({ error: "Contenu docker-compose.yml requis." }, { status: 400 });

  const jobId = startJob("docker-stack-deploy", `Déploiement ${name.trim()}`, Number(hostId));

  createAndDeployStack(Number(hostId), name.trim(), composeContent, (t) => appendJobLog(jobId, t))
    .then((stack) => finishJob(jobId, "success", { stack }))
    .catch((err) => {
      appendJobLog(jobId, `\nErreur : ${err instanceof Error ? err.message : "Erreur."}\n`);
      finishJob(jobId, "failed");
    });

  return NextResponse.json({ jobId });
}
