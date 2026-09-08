import { NextRequest, NextResponse } from "next/server";
import { listLogSources, addLogSource } from "@/lib/logSources";
import { logAudit } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ sources: listLogSources() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { hostId, hostName, containerId, containerName, filePath, label, category } = body;

  if (!hostId || !containerId || !label || !category) {
    return NextResponse.json({ error: "Champs requis manquants." }, { status: 400 });
  }
  if (!["web-access", "web-error", "mail"].includes(category)) {
    return NextResponse.json({ error: "Catégorie invalide." }, { status: 400 });
  }

  const source = addLogSource({
    hostId: Number(hostId),
    hostName: hostName ?? "",
    containerId,
    containerName: containerName ?? "",
    filePath: filePath || null,
    label,
    category,
  });
  logAudit("logsource.created", source.id, label);
  return NextResponse.json({ source }, { status: 201 });
}
