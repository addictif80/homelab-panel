import { NextRequest, NextResponse } from "next/server";
import { addMailLogSource, listMailLogSources, type MailSourceType } from "@/lib/mail/mailIngest";
import { logAudit } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ sources: listMailLogSources() });
}

export async function POST(req: NextRequest) {
  const { hostId, sourceType, sourcePath, rspamdPort, rspamdPassword } = (await req.json()) as {
    hostId?: number;
    sourceType?: MailSourceType;
    sourcePath?: string;
    rspamdPort?: number;
    rspamdPassword?: string;
  };
  if (!hostId || !sourceType || !sourcePath?.trim()) {
    return NextResponse.json({ error: "Hôte, type de source et chemin/conteneur requis." }, { status: 400 });
  }
  if (sourceType !== "file" && sourceType !== "docker" && sourceType !== "rspamd_api") {
    return NextResponse.json({ error: "Type de source invalide." }, { status: 400 });
  }
  if (sourceType === "rspamd_api" && !rspamdPort) {
    return NextResponse.json({ error: "Port de l'API rspamd requis (11334 par défaut)." }, { status: 400 });
  }

  const source = addMailLogSource(hostId, sourceType, sourcePath, { rspamdPort, rspamdPassword });
  logAudit("mail.source_added", String(hostId), sourcePath);
  return NextResponse.json({ source });
}
