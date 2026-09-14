import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { constructWebhookEvent, getSubscriptionPeriodEnd, extractPeriodEnd, type PlanKey } from "@/lib/seller/stripe";
import { recordSale, saleExistsForSession, updateSubscriptionState, getSale } from "@/lib/seller/sales";
import { createDownloadToken } from "@/lib/seller/downloadTokens";
import { createLicenseKey, getLicenseKeyForSale } from "@/lib/seller/licenseKeys";
import { keyRecoveryOrderExists, recordKeyRecoveryOrder } from "@/lib/seller/keyRecovery";
import { sendMail } from "@/lib/mail";
import { buttonEmailHtml } from "@/lib/emailTemplates";
import { logAudit } from "@/lib/db";
import { resolvePublicUrl } from "@/lib/seller/publicUrl";

/**
 * The paid key-recovery flow has no `sales` row of its own — it's a fee to re-send a key from an
 * *existing* lifetime sale, recorded in key_recovery_orders instead. Checked and branched off
 * before the normal licensing-plan path below, which would otherwise treat it as a fresh purchase.
 */
async function handleKeyRecoveryCompleted(session: Stripe.Checkout.Session) {
  if (keyRecoveryOrderExists(session.id)) return;

  const email = session.customer_details?.email || session.metadata?.email || "";
  const saleId = session.metadata?.saleId || null;
  recordKeyRecoveryOrder({
    stripeSessionId: session.id,
    email,
    amountCents: session.amount_total ?? 0,
    currency: session.currency ?? "eur",
    saleId,
  });

  const sale = saleId ? getSale(saleId) : null;
  const license = sale ? getLicenseKeyForSale(sale.id) : null;

  if (email) {
    try {
      if (license) {
        await sendMail(
          "Ta clé de licence — Homelab Panel",
          `Voici ta clé d'activation lifetime :\n${license.key}\n\nColle-la directement dans ton panel (bandeau d'essai expiré ou page d'activation) pour réactiver ton installation.`,
          email
        );
      } else {
        await sendMail(
          "Récupération de clé — Homelab Panel",
          "Nous n'avons pas retrouvé de clé associée à ton achat. Réponds à cet email, on s'en occupe manuellement.",
          email
        );
      }
    } catch {
      // Order is recorded either way — the seller can resend manually from /seller if needed.
    }
  }

  logAudit("seller.key_recovery_completed", session.id, email);
}

async function handleCheckoutCompleted(req: NextRequest, session: Stripe.Checkout.Session) {
  if (session.metadata?.type === "key_recovery") {
    await handleKeyRecoveryCompleted(session);
    return;
  }

  const email = session.customer_details?.email;
  if (!email) {
    logAudit("seller.sale_missing_email", session.id);
    return;
  }
  if (saleExistsForSession(session.id)) return;

  const plan = (session.metadata?.plan as PlanKey | undefined) ?? "lifetime";
  const isSubscription = plan !== "lifetime";
  const subscriptionId = isSubscription && typeof session.subscription === "string" ? session.subscription : undefined;
  const currentPeriodEnd = subscriptionId ? await getSubscriptionPeriodEnd(subscriptionId).catch(() => null) : null;

  const sale = recordSale({
    stripeSessionId: session.id,
    customerEmail: email,
    amountCents: session.amount_total ?? 0,
    currency: session.currency ?? "eur",
    productType: plan,
    stripeSubscriptionId: subscriptionId,
    subscriptionStatus: isSubscription ? "active" : null,
    currentPeriodEnd,
  });
  const token = createDownloadToken(sale.id);
  const downloadUrl = `${resolvePublicUrl(req.nextUrl.origin)}/api/download/${token}`;
  const license = createLicenseKey(sale.id);

  const planLabel = plan === "monthly" ? "abonnement mensuel" : plan === "annual" ? "abonnement annuel" : "achat";

  try {
    await sendMail(
      "Ton lien de téléchargement — Homelab Panel",
      `Merci pour ton ${planLabel} !\n\nTélécharge ton exemplaire ici (lien à usage unique, valable 7 jours) :\n${downloadUrl}\n\nTa clé d'activation (déjà incluse dans ce téléchargement, mais garde-la de côté) :\n${license.key}\n\nSi tu as déjà une version d'essai en cours ailleurs, tu peux coller cette clé directement dans le panel au lieu de retélécharger.\n\nSi le lien a expiré ou a déjà été utilisé par erreur, réponds à cet email.`,
      email,
      buttonEmailHtml({
        intro: `Merci pour ton ${planLabel} ! Ton exemplaire de Homelab Panel est prêt à télécharger.<br><br>Ta clé d'activation (déjà incluse dans ce téléchargement, garde-la de côté) : <strong>${license.key}</strong><br>Si tu as déjà une version d'essai en cours ailleurs, colle cette clé directement dans le panel au lieu de retélécharger.`,
        buttonLabel: "Télécharger mon exemplaire",
        buttonUrl: downloadUrl,
        footerNote: "Lien à usage unique, valable 7 jours. S'il a expiré ou déjà été utilisé par erreur, réponds à cet email.",
      })
    );
  } catch {
    // The sale, token and key are recorded either way — worst case, resend manually from /seller.
  }

  logAudit("seller.sale_recorded", sale.id, email);
}

/**
 * Keeps the seller's own record of a subscription's paid-through date and status current —
 * fired on renewal, plan change, a failed payment retry, or cancellation. The client itself never
 * receives a push from here: it finds out on its own next periodic call to
 * /api/seller/license/refresh, which reads whatever this last wrote.
 */
function handleSubscriptionEvent(sub: Stripe.Subscription) {
  const status = sub.status === "active" || sub.status === "trialing" ? "active" : sub.status === "past_due" ? "past_due" : "canceled";
  updateSubscriptionState(sub.id, { subscriptionStatus: status, currentPeriodEnd: extractPeriodEnd(sub) });
  logAudit("seller.subscription_updated", sub.id, status);
}

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

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(req, event.data.object as Stripe.Checkout.Session);
      break;
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      handleSubscriptionEvent(event.data.object as Stripe.Subscription);
      break;
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
