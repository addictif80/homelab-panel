import { NextRequest, NextResponse } from "next/server";
import { createCheckoutSession } from "@/lib/seller/stripe";

export async function POST(req: NextRequest) {
  try {
    const origin = req.nextUrl.origin;
    const url = await createCheckoutSession(`${origin}/store/success`, `${origin}/store`);
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 400 });
  }
}
