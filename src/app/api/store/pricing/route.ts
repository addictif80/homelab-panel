import { NextResponse } from "next/server";
import { getPricing } from "@/lib/seller/stripe";
import { getTrialDays } from "@/lib/seller/trialConfig";
import { getKeyRecoveryConfig } from "@/lib/seller/keyRecovery";
import { getLandingCta } from "@/lib/seller/landingCta";

/** Public, unauthenticated: the landing page needs the prices, product copy, trial length, and the
 * optional seller-configured promo banner. */
export async function GET() {
  const pricing = getPricing();
  const trialDays = getTrialDays();
  const keyRecovery = getKeyRecoveryConfig();
  const landingCta = getLandingCta();
  if (!pricing) return NextResponse.json({ pricing: null, trialDays, keyRecovery, landingCta });
  const { currency, productName, productDescription, plans } = pricing;
  return NextResponse.json({
    pricing: { currency, productName, productDescription, plans },
    trialDays,
    keyRecovery,
    landingCta,
  });
}
