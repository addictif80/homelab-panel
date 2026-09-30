import { NextRequest, NextResponse } from "next/server";
import { listMigrations, startMailMigration } from "@/lib/mail/migration";
import { logAudit } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ migrations: listMigrations() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    sourceHostId?: number;
    sourceDeployment?: "docker" | "native";
    sourceContainerId?: string;
    sourceMailbox?: string;
    destHostId?: number;
    destDeployment?: "docker" | "native";
    destContainerId?: string;
    destMailbox?: string;
  };

  if (!body.sourceHostId || !body.sourceMailbox?.trim() || !body.destHostId || !body.destMailbox?.trim()) {
    return NextResponse.json(
      { error: "Machine source, boîte source, machine de destination et boîte de destination requises." },
      { status: 400 }
    );
  }
  if (body.sourceDeployment !== "native" && !body.sourceContainerId) {
    return NextResponse.json({ error: "Conteneur Dovecot source requis." }, { status: 400 });
  }
  if (body.destDeployment !== "native" && !body.destContainerId) {
    return NextResponse.json({ error: "Conteneur Dovecot de destination requis." }, { status: 400 });
  }
  if (body.sourceHostId === body.destHostId && body.sourceMailbox.trim() === body.destMailbox.trim()) {
    return NextResponse.json({ error: "La boîte source et la boîte de destination doivent différer (même machine, même adresse)." }, { status: 400 });
  }

  const id = startMailMigration({
    sourceHostId: body.sourceHostId,
    sourceDeployment: body.sourceDeployment,
    sourceContainerId: body.sourceContainerId,
    sourceMailbox: body.sourceMailbox.trim(),
    destHostId: body.destHostId,
    destDeployment: body.destDeployment,
    destContainerId: body.destContainerId,
    destMailbox: body.destMailbox.trim(),
  });
  logAudit("mail.migration_started", id, `${body.sourceMailbox} -> ${body.destMailbox}`);
  return NextResponse.json({ id }, { status: 202 });
}
