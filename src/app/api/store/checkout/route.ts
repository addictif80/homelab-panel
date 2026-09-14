import { NextRequest, NextResponse } from "next/server";
import { createCheckoutSession, PLAN_KEYS, type PlanKey } from "@/lib/seller/stripe";
import { resolvePublicUrl } from "@/lib/seller/publicUrl";

export async function POST(req: NextRequest) {
  try {
    const { plan } = (await req.json().catch(() => ({}))) as { plan?: PlanKey };
    const selectedPlan: PlanKey = plan && PLAN_KEYS.includes(plan) ? plan : "lifetime";
    const origin = resolvePublicUrl(req.nextUrl.origin);
    const url = await createCheckoutSession(selectedPlan, `${origin}/store/success`, `${origin}/store`);
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 400 });
  }
}
