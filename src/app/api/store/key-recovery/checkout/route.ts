import { NextRequest, NextResponse } from "next/server";
import { createKeyRecoveryCheckoutSession, getPricing } from "@/lib/seller/stripe";
import { getKeyRecoveryConfig } from "@/lib/seller/keyRecovery";
import { findLatestLifetimeSaleByEmail } from "@/lib/seller/sales";
import { resolvePublicUrl } from "@/lib/seller/publicUrl";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Confirms a lifetime purchase exists for this email *before* charging — without this check,
 * paying for key recovery with an email that never bought anything would just take someone's
 * money with nothing to send back.
 */
export async function POST(req: NextRequest) {
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  const trimmedEmail = (email || "").trim();
  if (!EMAIL_RE.test(trimmedEmail)) {
    return NextResponse.json({ error: "Adresse email invalide." }, { status: 400 });
  }

  const config = getKeyRecoveryConfig();
  if (!config.enabled || config.amountCents <= 0) {
    return NextResponse.json({ error: "La récupération de clé n'est pas disponible pour le moment." }, { status: 400 });
  }

  const sale = findLatestLifetimeSaleByEmail(trimmedEmail);
  if (!sale) {
    return NextResponse.json({ error: "Aucun achat à vie (lifetime) trouvé pour cette adresse email." }, { status: 404 });
  }

  const currency = getPricing()?.currency || "eur";
  const origin = resolvePublicUrl(req.nextUrl.origin);

  try {
    const url = await createKeyRecoveryCheckoutSession(
      trimmedEmail,
      config.amountCents,
      currency,
      `${origin}/store/success?type=recovery`,
      `${origin}/store`,
      { type: "key_recovery", email: trimmedEmail, saleId: sale.id }
    );
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 400 });
  }
}
