import Stripe from "stripe";
import { getSetting, setSetting } from "../db";
import { vaultEncrypt, vaultDecrypt } from "../crypto";

const SECRET_KEY_SETTING = "stripe_secret_key_encrypted";
const PUBLISHABLE_KEY_SETTING = "stripe_publishable_key";
const WEBHOOK_SECRET_SETTING = "stripe_webhook_secret_encrypted";
const PRICING_SETTING = "seller_pricing";

export type PlanKey = "lifetime" | "monthly" | "annual";
export const PLAN_KEYS: PlanKey[] = ["lifetime", "monthly", "annual"];

export type PlanPricing = {
  enabled: boolean;
  amountCents: number;
  productId?: string;
  priceId?: string;
};

export type Pricing = {
  currency: string;
  productName: string;
  productDescription: string;
  plans: Record<PlanKey, PlanPricing>;
};

const DEFAULT_PLAN: PlanPricing = { enabled: false, amountCents: 0 };

export function hasStripeSecretKey(): boolean {
  return !!getSetting(SECRET_KEY_SETTING);
}

export function setStripeSecretKey(key: string): void {
  setSetting(SECRET_KEY_SETTING, vaultEncrypt(key));
}

function getStripeSecretKey(): string | null {
  const enc = getSetting(SECRET_KEY_SETTING);
  return enc ? vaultDecrypt(enc) : null;
}

// Not secret by design (Stripe's own docs say so) — stored in the clear like other plain
// settings, unlike the secret key and webhook signing secret above.
export function getPublishableKey(): string | null {
  return getSetting(PUBLISHABLE_KEY_SETTING);
}

export function setPublishableKey(key: string): void {
  setSetting(PUBLISHABLE_KEY_SETTING, key);
}

export function hasWebhookSecret(): boolean {
  return !!getSetting(WEBHOOK_SECRET_SETTING);
}

export function setWebhookSecret(secret: string): void {
  setSetting(WEBHOOK_SECRET_SETTING, vaultEncrypt(secret));
}

function getWebhookSecret(): string | null {
  const enc = getSetting(WEBHOOK_SECRET_SETTING);
  return enc ? vaultDecrypt(enc) : null;
}

export function getPricing(): Pricing | null {
  const raw = getSetting(PRICING_SETTING);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Pricing;
  // Backfill any plan missing from an older save (e.g. upgrading from before subscriptions
  // existed, when this setting only ever described the lifetime plan).
  for (const key of PLAN_KEYS) {
    if (!parsed.plans?.[key]) parsed.plans = { ...parsed.plans, [key]: DEFAULT_PLAN };
  }
  return parsed;
}

function savePricing(pricing: Pricing): void {
  setSetting(PRICING_SETTING, JSON.stringify(pricing));
}

function getStripeClient(): Stripe {
  const key = getStripeSecretKey();
  if (!key) throw new Error("Clé secrète Stripe non configurée.");
  return new Stripe(key);
}

const PLAN_INTERVAL: Record<PlanKey, "month" | "year" | null> = {
  lifetime: null,
  monthly: "month",
  annual: "year",
};

export type PlanInput = { enabled: boolean; amountCents: number };

/**
 * Keeps up to three Stripe Prices in sync with the seller's configured tariffs — one shared
 * Product ("Homelab Panel"), one Price per enabled plan. Stripe Prices are immutable once
 * created, so "editing" a price really means: create a fresh one and archive the old one, same
 * as the original lifetime-only version of this function did.
 */
export async function syncPricing(input: {
  currency: string;
  productName: string;
  productDescription: string;
  plans: Record<PlanKey, PlanInput>;
}): Promise<Pricing> {
  const stripe = getStripeClient();
  const current = getPricing();

  let productId = current?.plans.lifetime.productId || current?.plans.monthly.productId || current?.plans.annual.productId;
  if (!productId) {
    const product = await stripe.products.create({ name: input.productName, description: input.productDescription });
    productId = product.id;
  } else if (current!.productName !== input.productName || current!.productDescription !== input.productDescription) {
    await stripe.products.update(productId, { name: input.productName, description: input.productDescription });
  }

  const plans = {} as Record<PlanKey, PlanPricing>;

  for (const key of PLAN_KEYS) {
    const wanted = input.plans[key];
    const existing = current?.plans[key];

    if (!wanted.enabled) {
      plans[key] = { enabled: false, amountCents: wanted.amountCents, productId, priceId: existing?.priceId };
      continue;
    }

    const priceChanged = !existing?.enabled || !existing.priceId || existing.amountCents !== wanted.amountCents || current?.currency !== input.currency;

    let priceId = existing?.priceId;
    if (priceChanged) {
      const interval = PLAN_INTERVAL[key];
      const newPrice = await stripe.prices.create({
        product: productId,
        unit_amount: wanted.amountCents,
        currency: input.currency,
        ...(interval ? { recurring: { interval } } : {}),
      });
      if (priceId) await stripe.prices.update(priceId, { active: false }).catch(() => {});
      priceId = newPrice.id;
    }

    plans[key] = { enabled: true, amountCents: wanted.amountCents, productId, priceId };
  }

  const pricing: Pricing = { currency: input.currency, productName: input.productName, productDescription: input.productDescription, plans };
  savePricing(pricing);
  return pricing;
}

/**
 * `plan` rides along as Checkout Session metadata (rather than being re-derived from the Price
 * object later) so the webhook can tell a monthly subscription from an annual one — and the sale
 * from a lifetime purchase — without an extra round trip to Stripe.
 */
export async function createCheckoutSession(plan: PlanKey, successUrl: string, cancelUrl: string): Promise<string> {
  const stripe = getStripeClient();
  const pricing = getPricing();
  const planPricing = pricing?.plans[plan];
  if (!planPricing?.enabled || !planPricing.priceId) throw new Error("Cette offre n'est pas configurée.");

  const session = await stripe.checkout.sessions.create({
    mode: plan === "lifetime" ? "payment" : "subscription",
    line_items: [{ price: planPricing.priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { plan },
  });
  if (!session.url) throw new Error("Impossible de créer la session de paiement Stripe.");
  return session.url;
}

export function constructWebhookEvent(rawBody: string, signature: string): Stripe.Event {
  const stripe = getStripeClient();
  const secret = getWebhookSecret();
  if (!secret) throw new Error("Secret de webhook Stripe non configuré.");
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

// current_period_end moved from the Subscription object itself to each SubscriptionItem in newer
// Stripe API versions (multiple prices per subscription can now bill on different cycles) —
// check the item first, fall back to the old top-level field for older accounts.
export function extractPeriodEnd(sub: Stripe.Subscription): string | null {
  const itemPeriodEnd = sub.items.data[0]?.current_period_end;
  const legacyPeriodEnd = (sub as unknown as { current_period_end?: number }).current_period_end;
  const periodEnd = itemPeriodEnd ?? legacyPeriodEnd;
  return periodEnd ? new Date(periodEnd * 1000).toISOString() : null;
}

/** Used by the webhook handler right after checkout to learn a fresh subscription's current
 * paid-through date — needed to set the sale's initial current_period_end. */
export async function getSubscriptionPeriodEnd(subscriptionId: string): Promise<string | null> {
  const stripe = getStripeClient();
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  return extractPeriodEnd(sub);
}
