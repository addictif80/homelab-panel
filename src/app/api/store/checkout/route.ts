import { NextRequest, NextResponse } from "next/server";
import { createCheckoutSession } from "@/lib/seller/stripe";
import { resolvePublicUrl } from "@/lib/seller/publicUrl";

export async function POST(req: NextRequest) {
  try {
    const origin = resolvePublicUrl(req.nextUrl.origin);
    const url = await createCheckoutSession(`${origin}/store/success`, `${origin}/store`);
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 400 });
  }
}
