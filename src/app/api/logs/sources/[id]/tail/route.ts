import { NextRequest, NextResponse } from "next/server";
import { getLogSource } from "@/lib/logSources";
import { containerLogs, tailContainerFile } from "@/lib/docker";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tail = Number(req.nextUrl.searchParams.get("tail") || 200);

  const source = getLogSource(id);
  if (!source) return NextResponse.json({ error: "Source de logs introuvable." }, { status: 404 });

  try {
    const lines = source.filePath
      ? await tailContainerFile(source.hostId, source.containerId, source.filePath, tail)
      : await containerLogs(source.hostId, source.containerId, tail);
    return NextResponse.json({ lines });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur Docker." }, { status: 502 });
  }
}
