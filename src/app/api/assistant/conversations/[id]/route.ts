import { NextRequest, NextResponse } from "next/server";
import { getConversation, updateConversationMessages, renameConversation, deleteConversation } from "@/lib/assistantHistory";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const conversation = getConversation(id);
  if (!conversation) return NextResponse.json({ error: "Conversation introuvable." }, { status: 404 });
  return NextResponse.json({ conversation });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getConversation(id)) return NextResponse.json({ error: "Conversation introuvable." }, { status: 404 });

  const body = (await req.json()) as { messages?: unknown[]; title?: string };
  if (body.messages !== undefined) {
    if (!Array.isArray(body.messages)) {
      return NextResponse.json({ error: "Messages invalides." }, { status: 400 });
    }
    updateConversationMessages(id, body.messages);
  }
  if (body.title !== undefined) {
    renameConversation(id, body.title);
  }
  return NextResponse.json({ conversation: getConversation(id) });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deleteConversation(id);
  return NextResponse.json({ ok: true });
}
