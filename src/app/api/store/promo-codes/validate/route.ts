import { NextRequest, NextResponse } from "next/server";
import { validatePromoCodeForPlan } from "@/lib/seller/promoCodes";
import { getPricing, PLAN_KEYS, type PlanKey } from "@/lib/seller/stripe";

function formatAmount(amountCents: number, currency: string): string {
  const amount = (amountCents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${amount} ${currency.toLowerCase() === "eur" ? "€" : currency.toUpperCase()}`;
}

export async function POST(req: NextRequest) {
  const { code, plan } = (await req.json().catch(() => ({}))) as { code?: string; plan?: PlanKey };
  if (!code || !plan || !PLAN_KEYS.includes(plan)) {
    return NextResponse.json({ valid: false, error: "Code et offre requis." }, { status: 400 });
  }

  const result = validatePromoCodeForPlan(code, plan);
  if (!result.valid) return NextResponse.json({ valid: false, error: result.error }, { status: 400 });

  const pricing = getPricing();
  const planPricing = pricing?.plans[plan];
  if (!planPricing?.enabled) return NextResponse.json({ valid: false, error: "Cette offre n'est pas disponible." }, { status: 400 });

  const currency = pricing?.currency || "eur";
  const discounted =
    result.promo.discountType === "percent"
      ? Math.round(planPricing.amountCents * (1 - result.promo.discountValue / 100))
      : Math.max(0, planPricing.amountCents - result.promo.discountValue);

  return NextResponse.json({
    valid: true,
    discountedAmountCents: discounted,
    discountedLabel: formatAmount(discounted, currency),
  });
}
