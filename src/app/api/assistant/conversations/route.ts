import { NextRequest, NextResponse } from "next/server";
import { listConversations, createConversation, type ConversationKind } from "@/lib/assistantHistory";

export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind");
  if (kind !== "chat" && kind !== "agent") {
    return NextResponse.json({ error: "Paramètre 'kind' invalide." }, { status: 400 });
  }
  return NextResponse.json({ conversations: listConversations(kind) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { kind?: ConversationKind; messages?: { role: string; content: string }[] };
  if (body.kind !== "chat" && body.kind !== "agent") {
    return NextResponse.json({ error: "Paramètre 'kind' invalide." }, { status: 400 });
  }
  if (!Array.isArray(body.messages)) {
    return NextResponse.json({ error: "Messages manquants." }, { status: 400 });
  }
  const conversation = createConversation(body.kind, body.messages);
  return NextResponse.json({ conversation });
}
