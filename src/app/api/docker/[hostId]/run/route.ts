import { NextRequest, NextResponse } from "next/server";
import { runNewContainer, type NewContainerSpec } from "@/lib/docker";
import { logAudit } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  const spec = (await req.json()) as NewContainerSpec;
  if (!spec.image) {
    return NextResponse.json({ error: "L'image est requise." }, { status: 400 });
  }
  try {
    const containerId = await runNewContainer(Number(hostId), spec);
    logAudit("docker.run", hostId, spec.image);
    return NextResponse.json({ containerId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur Docker." }, { status: 502 });
  }
}
