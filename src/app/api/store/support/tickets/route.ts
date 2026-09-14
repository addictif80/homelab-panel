import { NextRequest, NextResponse } from "next/server";
import { createTicket } from "@/lib/seller/supportTickets";
import { sendMail } from "@/lib/mail";
import { buttonEmailHtml } from "@/lib/emailTemplates";
import { resolvePublicUrl } from "@/lib/seller/publicUrl";
import { logAudit } from "@/lib/db";
import { notifyAll } from "@/lib/notifications/notify";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const { email, subject, message } = (await req.json().catch(() => ({}))) as {
    email?: string;
    subject?: string;
    message?: string;
  };
  const trimmedEmail = (email || "").trim();
  const trimmedSubject = (subject || "").trim();
  const trimmedMessage = (message || "").trim();

  if (!EMAIL_RE.test(trimmedEmail)) return NextResponse.json({ error: "Adresse email invalide." }, { status: 400 });
  if (!trimmedSubject) return NextResponse.json({ error: "Sujet requis." }, { status: 400 });
  if (!trimmedMessage) return NextResponse.json({ error: "Message requis." }, { status: 400 });

  const ticket = createTicket(trimmedEmail, trimmedSubject, trimmedMessage);
  const ticketUrl = `${resolvePublicUrl(req.nextUrl.origin)}/store/support/${ticket.id}?token=${ticket.accessToken}`;

  try {
    await sendMail(
      `Ticket reçu — ${trimmedSubject}`,
      `Ton message a bien été reçu, on te répond au plus vite.\n\nSuis et complète ton ticket ici :\n${ticketUrl}`,
      trimmedEmail,
      buttonEmailHtml({
        intro: `Ton message a bien été reçu, on te répond au plus vite.<br><br><strong>Sujet :</strong> ${trimmedSubject}`,
        buttonLabel: "Voir mon ticket",
        buttonUrl: ticketUrl,
        footerNote: "Garde ce lien de côté — c'est le seul moyen de retrouver ce ticket.",
      })
    );
  } catch {
    // Ticket is recorded either way — the UI also hands the buyer the same link immediately.
  }

  logAudit("seller.support_ticket_created", ticket.id, trimmedEmail);

  // Best-effort fan-out (email + any configured webhook/ntfy/Discord/Slack) — never throws.
  await notifyAll(
    "Nouveau ticket d'assistance",
    `${trimmedEmail} — ${trimmedSubject}\n\n${trimmedMessage}\n\nRépondre : ${resolvePublicUrl(req.nextUrl.origin)}/seller`
  );

  return NextResponse.json({ id: ticket.id, token: ticket.accessToken });
}
