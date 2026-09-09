import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { constructWebhookEvent } from "@/lib/seller/stripe";
import { recordSale, saleExistsForSession } from "@/lib/seller/sales";
import { createDownloadToken } from "@/lib/seller/downloadTokens";
import { sendMail } from "@/lib/mail";
import { buttonEmailHtml } from "@/lib/emailTemplates";
import { logAudit } from "@/lib/db";

export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  const rawBody = await req.text();
  if (!signature) return NextResponse.json({ error: "Signature manquante." }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(rawBody, signature);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Signature invalide." }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const email = session.customer_details?.email;

    if (!email) {
      logAudit("seller.sale_missing_email", session.id);
    } else if (!saleExistsForSession(session.id)) {
      const sale = recordSale({
        stripeSessionId: session.id,
        customerEmail: email,
        amountCents: session.amount_total ?? 0,
        currency: session.currency ?? "eur",
      });
      const token = createDownloadToken(sale.id);
      const downloadUrl = `${req.nextUrl.origin}/api/download/${token}`;

      try {
        await sendMail(
          "Ton lien de téléchargement — Homelab Panel",
          `Merci pour ton achat !\n\nTélécharge ton exemplaire ici (lien à usage unique, valable 7 jours) :\n${downloadUrl}\n\nSi le lien a expiré ou a déjà été utilisé par erreur, réponds à cet email.`,
          email,
          buttonEmailHtml({
            intro: "Merci pour ton achat ! Ton exemplaire de Homelab Panel est prêt à télécharger.",
            buttonLabel: "Télécharger mon exemplaire",
            buttonUrl: downloadUrl,
            footerNote: "Lien à usage unique, valable 7 jours. S'il a expiré ou déjà été utilisé par erreur, réponds à cet email.",
          })
        );
      } catch {
        // The sale and token are recorded either way — worst case, resend manually from /seller.
      }

      logAudit("seller.sale_recorded", sale.id, email);
    }
  }

  return NextResponse.json({ received: true });
}
