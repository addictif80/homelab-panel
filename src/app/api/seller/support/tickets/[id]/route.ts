import { NextRequest, NextResponse } from "next/server";
import { getTicket, listMessages, setTicketStatus, type TicketStatus } from "@/lib/seller/supportTickets";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ticket = getTicket(id);
  if (!ticket) return NextResponse.json({ error: "Ticket introuvable." }, { status: 404 });
  return NextResponse.json({ ticket, messages: listMessages(id) });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ticket = getTicket(id);
  if (!ticket) return NextResponse.json({ error: "Ticket introuvable." }, { status: 404 });

  const { status } = (await req.json().catch(() => ({}))) as { status?: TicketStatus };
  if (status !== "open" && status !== "closed") {
    return NextResponse.json({ error: "Statut invalide." }, { status: 400 });
  }
  setTicketStatus(id, status);
  return NextResponse.json({ ok: true });
}
