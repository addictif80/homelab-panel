import { NextResponse } from "next/server";
import { getPricing } from "@/lib/seller/stripe";

/** Public, unauthenticated: the landing page needs the price and product copy, nothing else. */
export async function GET() {
  const pricing = getPricing();
  if (!pricing) return NextResponse.json({ pricing: null });
  const { amountCents, currency, productName, productDescription } = pricing;
  return NextResponse.json({ pricing: { amountCents, currency, productName, productDescription } });
}
