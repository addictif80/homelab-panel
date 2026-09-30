import { NextRequest, NextResponse } from "next/server";
import { listMailboxes } from "@/lib/backup/sources/mailbox";

/** Lists the mailboxes Dovecot's userdb knows about — powers the "Tester la connexion" button in
 * the plan editor for a mailbox source, same purpose as test-database's route for database plans. */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    hostId?: number;
    deployment?: "docker" | "native";
    containerId?: string;
  };

  if (!body.hostId) {
    return NextResponse.json({ error: "Machine requise." }, { status: 400 });
  }
  if (body.deployment !== "native" && !body.containerId) {
    return NextResponse.json({ error: "Conteneur Dovecot requis." }, { status: 400 });
  }

  try {
    const mailboxes = await listMailboxes(body.hostId, { deployment: body.deployment, containerId: body.containerId });
    return NextResponse.json({ mailboxes });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Connexion impossible." }, { status: 400 });
  }
}
