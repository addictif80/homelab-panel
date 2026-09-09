import Stripe from "stripe";
import { getSetting, setSetting } from "../db";
import { vaultEncrypt, vaultDecrypt } from "../crypto";

const SECRET_KEY_SETTING = "stripe_secret_key_encrypted";
const WEBHOOK_SECRET_SETTING = "stripe_webhook_secret_encrypted";
const PRICING_SETTING = "seller_pricing";

export type Pricing = {
  amountCents: number;
  currency: string;
  productName: string;
  productDescription: string;
  productId?: string;
  priceId?: string;
};

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
  return raw ? JSON.parse(raw) : null;
}

function savePricing(pricing: Pricing): void {
  setSetting(PRICING_SETTING, JSON.stringify(pricing));
}

function getStripeClient(): Stripe {
  const key = getStripeSecretKey();
  if (!key) throw new Error("Clé secrète Stripe non configurée.");
  return new Stripe(key);
}

/**
 * Keeps a single Stripe Product/Price in sync with the configured tarif. Stripe Price objects
 * are immutable once created, so "the price updates itself" really means: create the product
 * once, and every time the amount (or name/description) changes, create a fresh Price and
 * archive the previous one — from here it looks like one editable price.
 */
export async function syncPricing(input: {
  amountCents: number;
  currency: string;
  productName: string;
  productDescription: string;
}): Promise<Pricing> {
  const stripe = getStripeClient();
  const current = getPricing();

  let productId = current?.productId;
  if (!productId) {
    const product = await stripe.products.create({ name: input.productName, description: input.productDescription });
    productId = product.id;
  } else if (current!.productName !== input.productName || current!.productDescription !== input.productDescription) {
    await stripe.products.update(productId, { name: input.productName, description: input.productDescription });
  }

  const priceChanged = !current?.priceId || current.amountCents !== input.amountCents || current.currency !== input.currency;
  let priceId = current?.priceId;
  if (priceChanged) {
    const newPrice = await stripe.prices.create({
      product: productId,
      unit_amount: input.amountCents,
      currency: input.currency,
    });
    if (priceId) await stripe.prices.update(priceId, { active: false }).catch(() => {});
    priceId = newPrice.id;
  }

  const pricing: Pricing = { ...input, productId, priceId };
  savePricing(pricing);
  return pricing;
}

export async function createCheckoutSession(successUrl: string, cancelUrl: string): Promise<string> {
  const stripe = getStripeClient();
  const pricing = getPricing();
  if (!pricing?.priceId) throw new Error("Le tarif n'est pas encore configuré.");

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: pricing.priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
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
