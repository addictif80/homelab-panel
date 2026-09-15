import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { recordSale } from "@/lib/seller/sales";
import { createLicenseKey } from "@/lib/seller/licenseKeys";
import { sendMail } from "@/lib/mail";
import { simpleEmailHtml } from "@/lib/emailTemplates";
import { logAudit } from "@/lib/db";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A lifetime key with no real Stripe payment behind it — a reviewer copy, a partner deal, a
 * goodwill gesture after a refund dispute, testing... Reuses the exact same sales/license-key/
 * certificate machinery as a real purchase (a synthetic `manual-<uuid>` session id keeps it out of
 * saleExistsForSession's real-webhook dedup path) so the resulting key activates exactly like any
 * other, and shows up in the same "Clés d'activation" list — at 0€, which doesn't skew the URSSAF
 * revenue total since it just adds zero.
 */
export async function POST(req: NextRequest) {
  const { email, note } = (await req.json().catch(() => ({}))) as { email?: string; note?: string };
  const trimmedEmail = (email || "").trim();
  if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) {
    return NextResponse.json({ error: "Adresse email invalide." }, { status: 400 });
  }

  const sale = recordSale({
    stripeSessionId: `manual-${randomUUID()}`,
    customerEmail: trimmedEmail || "génération-manuelle",
    amountCents: 0,
    currency: "eur",
    productType: "lifetime",
    notes: note?.trim() || null,
  });
  const license = createLicenseKey(sale.id);

  if (trimmedEmail) {
    const text = `Voici ta clé d'activation lifetime :\n${license.key}\n\nColle-la directement dans le panel (page d'activation) pour l'activer.`;
    try {
      await sendMail("Ta clé d'activation — Homelab Panel", text, trimmedEmail, simpleEmailHtml(text));
    } catch {
      // The key is recorded either way — visible and copyable from the seller list.
    }
  }

  logAudit("seller.manual_key_generated", sale.id, trimmedEmail || note || undefined);
  return NextResponse.json({ key: license.key, saleId: sale.id });
}
