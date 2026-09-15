import { randomUUID } from "crypto";
import { getDb } from "../db";
import {
  createPromoCodeOnStripe,
  setPromotionCodeActiveOnStripe,
  getPromotionCodeRedemptions,
  getPricing,
  type PromoDiscountType,
} from "./stripe";
import { PLAN_KEYS, type PlanKey } from "./stripe";

export type PromoCode = {
  id: string;
  code: string;
  discountType: PromoDiscountType;
  discountValue: number;
  applicablePlans: PlanKey[];
  maxRedemptions: number | null;
  validFrom: string | null;
  validUntil: string | null;
  enabled: boolean;
  stripeCouponId: string | null;
  stripePromotionCodeId: string | null;
  createdAt: string;
};

type PromoCodeRow = {
  id: string;
  code: string;
  discount_type: PromoDiscountType;
  discount_value: number;
  applicable_plans: string;
  max_redemptions: number | null;
  valid_from: string | null;
  valid_until: string | null;
  enabled: number;
  stripe_coupon_id: string | null;
  stripe_promotion_code_id: string | null;
  created_at: string;
};

function rowToPromoCode(row: PromoCodeRow): PromoCode {
  return {
    id: row.id,
    code: row.code,
    discountType: row.discount_type,
    discountValue: row.discount_value,
    applicablePlans: JSON.parse(row.applicable_plans),
    maxRedemptions: row.max_redemptions,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    enabled: !!row.enabled,
    stripeCouponId: row.stripe_coupon_id,
    stripePromotionCodeId: row.stripe_promotion_code_id,
    createdAt: row.created_at,
  };
}

export type CreatePromoCodeInput = {
  code: string;
  discountType: PromoDiscountType;
  discountValue: number;
  applicablePlans: PlanKey[];
  maxRedemptions?: number | null;
  validFrom?: string | null;
  validUntil?: string | null;
};

export async function createPromoCode(input: CreatePromoCodeInput): Promise<PromoCode> {
  const code = input.code.trim().toUpperCase();
  if (!code) throw new Error("Code requis.");
  if (input.discountType === "percent" && (input.discountValue < 1 || input.discountValue > 100)) {
    throw new Error("La remise en pourcentage doit être entre 1 et 100.");
  }
  if (input.discountType === "amount" && input.discountValue <= 0) {
    throw new Error("La remise en montant doit être positive.");
  }
  const plans = input.applicablePlans.filter((p) => PLAN_KEYS.includes(p));
  if (plans.length === 0) throw new Error("Sélectionne au moins une offre applicable.");

  const currency = getPricing()?.currency || "eur";
  const { couponId, promotionCodeId } = await createPromoCodeOnStripe({
    code,
    discountType: input.discountType,
    discountValue: input.discountValue,
    currency,
    maxRedemptions: input.maxRedemptions,
    validUntil: input.validUntil,
  });

  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO promo_codes (id, code, discount_type, discount_value, applicable_plans, max_redemptions, valid_from, valid_until, stripe_coupon_id, stripe_promotion_code_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      code,
      input.discountType,
      input.discountValue,
      JSON.stringify(plans),
      input.maxRedemptions ?? null,
      input.validFrom ?? null,
      input.validUntil ?? null,
      couponId,
      promotionCodeId
    );

  return getPromoCode(id)!;
}

export function getPromoCode(id: string): PromoCode | null {
  const row = getDb().prepare(`SELECT * FROM promo_codes WHERE id = ?`).get(id) as PromoCodeRow | undefined;
  return row ? rowToPromoCode(row) : null;
}

export function getPromoCodeByCode(code: string): PromoCode | null {
  const row = getDb().prepare(`SELECT * FROM promo_codes WHERE code = ?`).get(code.trim().toUpperCase()) as
    | PromoCodeRow
    | undefined;
  return row ? rowToPromoCode(row) : null;
}

export function listPromoCodesRaw(): PromoCode[] {
  return (getDb().prepare(`SELECT * FROM promo_codes ORDER BY created_at DESC`).all() as PromoCodeRow[]).map(rowToPromoCode);
}

export type PromoCodeWithUsage = PromoCode & { timesRedeemed: number | null };

/** For the admin list view — fetches the live redemption count from Stripe per code. Best-effort:
 * if Stripe is unreachable for one code, its count just shows as unknown rather than failing the
 * whole list. */
export async function listPromoCodesWithUsage(): Promise<PromoCodeWithUsage[]> {
  const codes = listPromoCodesRaw();
  return Promise.all(
    codes.map(async (c) => {
      if (!c.stripePromotionCodeId) return { ...c, timesRedeemed: null };
      try {
        return { ...c, timesRedeemed: await getPromotionCodeRedemptions(c.stripePromotionCodeId) };
      } catch {
        return { ...c, timesRedeemed: null };
      }
    })
  );
}

export async function setPromoCodeEnabled(id: string, enabled: boolean): Promise<void> {
  const promo = getPromoCode(id);
  if (!promo) throw new Error("Code promo introuvable.");
  if (promo.stripePromotionCodeId) {
    await setPromotionCodeActiveOnStripe(promo.stripePromotionCodeId, enabled);
  }
  getDb().prepare(`UPDATE promo_codes SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id);
}

export async function deletePromoCode(id: string): Promise<void> {
  const promo = getPromoCode(id);
  if (!promo) return;
  // Stripe coupons/promotion codes can't be hard-deleted once created — deactivating is the
  // closest equivalent and is enough to stop it from being redeemed again.
  if (promo.stripePromotionCodeId) {
    await setPromotionCodeActiveOnStripe(promo.stripePromotionCodeId, false).catch(() => {});
  }
  getDb().prepare(`DELETE FROM promo_codes WHERE id = ?`).run(id);
}

export type PromoValidation = { valid: true; promo: PromoCode } | { valid: false; error: string };

/** Fast local pre-check for the storefront (existence, enabled, date window, plan match) — Stripe
 * still re-checks redemption count and expiry authoritatively when the Checkout Session is
 * actually created, so a code that slipped past this (e.g. hit its redemption cap moments ago)
 * still can't be used twice. */
export function validatePromoCodeForPlan(code: string, plan: PlanKey): PromoValidation {
  const promo = getPromoCodeByCode(code);
  if (!promo) return { valid: false, error: "Code promo inconnu." };
  if (!promo.enabled) return { valid: false, error: "Ce code promo n'est plus actif." };
  if (!promo.applicablePlans.includes(plan)) return { valid: false, error: "Ce code promo ne s'applique pas à cette offre." };
  const now = Date.now();
  if (promo.validFrom && now < new Date(promo.validFrom).getTime()) {
    return { valid: false, error: "Ce code promo n'est pas encore actif." };
  }
  if (promo.validUntil && now > new Date(promo.validUntil).getTime()) {
    return { valid: false, error: "Ce code promo a expiré." };
  }
  return { valid: true, promo };
}
