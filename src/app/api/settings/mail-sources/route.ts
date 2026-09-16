import { NextRequest, NextResponse } from "next/server";
import { addMailLogSource, listMailLogSources } from "@/lib/mail/mailIngest";
import { logAudit } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ sources: listMailLogSources() });
}

export async function POST(req: NextRequest) {
  const { hostId, sourceType, sourcePath } = (await req.json()) as {
    hostId?: number;
    sourceType?: "file" | "docker";
    sourcePath?: string;
  };
  if (!hostId || !sourceType || !sourcePath?.trim()) {
    return NextResponse.json({ error: "Hôte, type de source et chemin/conteneur requis." }, { status: 400 });
  }
  if (sourceType !== "file" && sourceType !== "docker") {
    return NextResponse.json({ error: "Type de source invalide." }, { status: 400 });
  }

  const source = addMailLogSource(hostId, sourceType, sourcePath);
  logAudit("mail.source_added", String(hostId), sourcePath);
  return NextResponse.json({ source });
}
