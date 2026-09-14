import { NextRequest, NextResponse } from "next/server";
import { listStacks, createAndDeployStack } from "@/lib/dockerStacks";

export async function GET(_req: Request, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  return NextResponse.json({ stacks: listStacks(Number(hostId)) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  const { name, composeContent } = (await req.json().catch(() => ({}))) as { name?: string; composeContent?: string };
  if (!name?.trim()) return NextResponse.json({ error: "Nom requis." }, { status: 400 });
  if (!composeContent?.trim()) return NextResponse.json({ error: "Contenu docker-compose.yml requis." }, { status: 400 });

  const log: string[] = [];
  try {
    const stack = await createAndDeployStack(Number(hostId), name.trim(), composeContent, (t) => log.push(t));
    return NextResponse.json({ stack, log: log.join("") });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur.", log: log.join("") }, { status: 502 });
  }
}
