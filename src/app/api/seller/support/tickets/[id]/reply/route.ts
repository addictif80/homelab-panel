import { NextRequest, NextResponse } from "next/server";
import { getTicket, addMessage } from "@/lib/seller/supportTickets";
import { sendMail } from "@/lib/mail";
import { buttonEmailHtml } from "@/lib/emailTemplates";
import { resolvePublicUrl } from "@/lib/seller/publicUrl";
import { logAudit } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ticket = getTicket(id);
  if (!ticket) return NextResponse.json({ error: "Ticket introuvable." }, { status: 404 });

  const { message } = (await req.json().catch(() => ({}))) as { message?: string };
  const trimmed = (message || "").trim();
  if (!trimmed) return NextResponse.json({ error: "Message requis." }, { status: 400 });

  addMessage(id, "seller", trimmed);

  const ticketUrl = `${resolvePublicUrl(req.nextUrl.origin)}/store/support/${id}?token=${ticket.accessToken}`;
  try {
    await sendMail(
      `Réponse à ton ticket — ${ticket.subject}`,
      `${trimmed}\n\nRépondre ou suivre ce ticket :\n${ticketUrl}`,
      ticket.email,
      buttonEmailHtml({
        intro: `Nouvelle réponse à ton ticket <strong>${ticket.subject}</strong> :<br><br>${trimmed.replace(/\n/g, "<br>")}`,
        buttonLabel: "Voir et répondre",
        buttonUrl: ticketUrl,
      })
    );
  } catch {
    // Message is recorded either way — the customer can still find it via their saved link.
  }

  logAudit("seller.support_ticket_replied", id, ticket.email);
  return NextResponse.json({ ok: true });
}
