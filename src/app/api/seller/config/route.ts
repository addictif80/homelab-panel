import { NextRequest, NextResponse } from "next/server";
import { hasStripeSecretKey, hasWebhookSecret, setStripeSecretKey, setWebhookSecret, getPricing, syncPricing } from "@/lib/seller/stripe";

export async function GET(req: NextRequest) {
  return NextResponse.json({
    hasSecretKey: hasStripeSecretKey(),
    hasWebhookSecret: hasWebhookSecret(),
    pricing: getPricing(),
    webhookUrl: `${req.nextUrl.origin}/api/store/webhook`,
  });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as {
    secretKey?: string;
    webhookSecret?: string;
    amountCents?: number;
    currency?: string;
    productName?: string;
    productDescription?: string;
  };

  if (body.secretKey) setStripeSecretKey(body.secretKey);
  if (body.webhookSecret) setWebhookSecret(body.webhookSecret);

  if (body.amountCents && body.currency && body.productName) {
    try {
      const pricing = await syncPricing({
        amountCents: body.amountCents,
        currency: body.currency,
        productName: body.productName,
        productDescription: body.productDescription || "",
      });
      return NextResponse.json({ ok: true, pricing });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur Stripe." }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true });
}
