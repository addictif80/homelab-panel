import { NextRequest, NextResponse } from "next/server";
import { getTicketByToken, listMessages, addMessage } from "@/lib/seller/supportTickets";
import { notifyAll } from "@/lib/notifications/notify";
import { resolvePublicUrl } from "@/lib/seller/publicUrl";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.nextUrl.searchParams.get("token") || "";
  const ticket = getTicketByToken(id, token);
  if (!ticket) return NextResponse.json({ error: "Ticket introuvable." }, { status: 404 });
  return NextResponse.json({ ticket, messages: listMessages(id) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { token, message } = (await req.json().catch(() => ({}))) as { token?: string; message?: string };
  const ticket = getTicketByToken(id, token || "");
  if (!ticket) return NextResponse.json({ error: "Ticket introuvable." }, { status: 404 });

  const trimmed = (message || "").trim();
  if (!trimmed) return NextResponse.json({ error: "Message requis." }, { status: 400 });

  addMessage(id, "customer", trimmed);

  await notifyAll(
    `Nouvelle réponse — ${ticket.subject}`,
    `${ticket.email} a répondu :\n\n${trimmed}\n\nRépondre : ${resolvePublicUrl(req.nextUrl.origin)}/seller`
  );

  return NextResponse.json({ ok: true });
}
