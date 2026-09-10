import { NextResponse } from "next/server";
import { getPricing } from "@/lib/seller/stripe";
import { getTrialDays } from "@/lib/seller/trialConfig";

/** Public, unauthenticated: the landing page needs the price, product copy, and trial length. */
export async function GET() {
  const pricing = getPricing();
  const trialDays = getTrialDays();
  if (!pricing) return NextResponse.json({ pricing: null, trialDays });
  const { amountCents, currency, productName, productDescription } = pricing;
  return NextResponse.json({ pricing: { amountCents, currency, productName, productDescription }, trialDays });
}
