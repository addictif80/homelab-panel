import { NextRequest, NextResponse } from "next/server";
import {
  hasStripeSecretKey,
  hasWebhookSecret,
  setStripeSecretKey,
  setWebhookSecret,
  getPublishableKey,
  setPublishableKey,
  getPricing,
  syncPricing,
} from "@/lib/seller/stripe";
import { getTrialDays, setTrialDays } from "@/lib/seller/trialConfig";
import { getPanelPublicUrl, setPanelPublicUrl, resolvePublicUrl } from "@/lib/seller/publicUrl";

export async function GET(req: NextRequest) {
  return NextResponse.json({
    hasSecretKey: hasStripeSecretKey(),
    hasWebhookSecret: hasWebhookSecret(),
    publishableKey: getPublishableKey() ?? "",
    publicUrl: getPanelPublicUrl(),
    pricing: getPricing(),
    webhookUrl: `${resolvePublicUrl(req.nextUrl.origin)}/api/store/webhook`,
    trialDays: getTrialDays(),
  });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as {
    secretKey?: string;
    publishableKey?: string;
    webhookSecret?: string;
    publicUrl?: string;
    amountCents?: number;
    currency?: string;
    productName?: string;
    productDescription?: string;
    trialDays?: number;
  };

  if (body.secretKey) setStripeSecretKey(body.secretKey);
  if (body.publishableKey !== undefined) setPublishableKey(body.publishableKey.trim());
  if (body.webhookSecret) setWebhookSecret(body.webhookSecret);
  if (body.publicUrl !== undefined) {
    if (body.publicUrl && !/^https?:\/\//i.test(body.publicUrl)) {
      return NextResponse.json({ error: "L'URL publique doit commencer par http:// ou https://." }, { status: 400 });
    }
    setPanelPublicUrl(body.publicUrl);
  }
  if (body.trialDays) setTrialDays(body.trialDays);

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
