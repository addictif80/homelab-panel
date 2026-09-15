import { NextRequest, NextResponse } from "next/server";
import { createCheckoutSession, PLAN_KEYS, type PlanKey } from "@/lib/seller/stripe";
import { resolvePublicUrl } from "@/lib/seller/publicUrl";
import { validatePromoCodeForPlan } from "@/lib/seller/promoCodes";

export async function POST(req: NextRequest) {
  try {
    const { plan, promoCode } = (await req.json().catch(() => ({}))) as { plan?: PlanKey; promoCode?: string };
    const selectedPlan: PlanKey = plan && PLAN_KEYS.includes(plan) ? plan : "lifetime";
    const origin = resolvePublicUrl(req.nextUrl.origin);

    let promotionCodeId: string | undefined;
    if (promoCode?.trim()) {
      const result = validatePromoCodeForPlan(promoCode, selectedPlan);
      if (!result.valid) return NextResponse.json({ error: result.error }, { status: 400 });
      promotionCodeId = result.promo.stripePromotionCodeId ?? undefined;
    }

    const url = await createCheckoutSession(selectedPlan, `${origin}/store/success`, `${origin}/store`, promotionCodeId);
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 400 });
  }
}
