import { NextRequest, NextResponse } from "next/server";
import { listPromoCodesWithUsage, createPromoCode } from "@/lib/seller/promoCodes";
import type { PlanKey } from "@/lib/seller/stripe";
import { logAudit } from "@/lib/db";

export async function GET() {
  const codes = await listPromoCodesWithUsage();
  return NextResponse.json({ codes });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    code?: string;
    discountType?: "percent" | "amount";
    discountValue?: number;
    applicablePlans?: PlanKey[];
    maxRedemptions?: number | null;
    validFrom?: string | null;
    validUntil?: string | null;
  };

  if (!body.code || !body.discountType || !body.discountValue || !body.applicablePlans?.length) {
    return NextResponse.json({ error: "Code, type de remise, valeur et offres applicables requis." }, { status: 400 });
  }

  try {
    const promo = await createPromoCode({
      code: body.code,
      discountType: body.discountType,
      discountValue: body.discountValue,
      applicablePlans: body.applicablePlans,
      maxRedemptions: body.maxRedemptions ?? null,
      validFrom: body.validFrom ?? null,
      validUntil: body.validUntil ?? null,
    });
    logAudit("seller.promo_code_created", promo.id, promo.code);
    return NextResponse.json({ promo });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur Stripe." }, { status: 400 });
  }
}
