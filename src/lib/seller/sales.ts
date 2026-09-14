import { randomUUID } from "crypto";
import { getDb } from "../db";
import type { PlanKey } from "./stripe";

export type SubscriptionStatus = "active" | "past_due" | "canceled" | null;

export type Sale = {
  id: string;
  stripeSessionId: string;
  customerEmail: string;
  amountCents: number;
  currency: string;
  productType: PlanKey;
  stripeSubscriptionId: string | null;
  subscriptionStatus: SubscriptionStatus;
  currentPeriodEnd: string | null;
  createdAt: string;
};

type SaleRow = {
  id: string;
  stripe_session_id: string;
  customer_email: string;
  amount_cents: number;
  currency: string;
  product_type: PlanKey;
  stripe_subscription_id: string | null;
  subscription_status: SubscriptionStatus;
  current_period_end: string | null;
  created_at: string;
};

function rowToSale(row: SaleRow): Sale {
  return {
    id: row.id,
    stripeSessionId: row.stripe_session_id,
    customerEmail: row.customer_email,
    amountCents: row.amount_cents,
    currency: row.currency,
    productType: row.product_type,
    stripeSubscriptionId: row.stripe_subscription_id,
    subscriptionStatus: row.subscription_status,
    currentPeriodEnd: row.current_period_end,
    createdAt: row.created_at,
  };
}

export function saleExistsForSession(stripeSessionId: string): boolean {
  return !!getDb().prepare(`SELECT 1 FROM sales WHERE stripe_session_id = ?`).get(stripeSessionId);
}

export function recordSale(input: {
  stripeSessionId: string;
  customerEmail: string;
  amountCents: number;
  currency: string;
  productType: PlanKey;
  stripeSubscriptionId?: string;
  subscriptionStatus?: SubscriptionStatus;
  currentPeriodEnd?: string | null;
}): Sale {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO sales (id, stripe_session_id, customer_email, amount_cents, currency, product_type, stripe_subscription_id, subscription_status, current_period_end)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.stripeSessionId,
      input.customerEmail,
      input.amountCents,
      input.currency,
      input.productType,
      input.stripeSubscriptionId ?? null,
      input.subscriptionStatus ?? null,
      input.currentPeriodEnd ?? null
    );
  const row = getDb().prepare(`SELECT * FROM sales WHERE id = ?`).get(id) as SaleRow;
  return rowToSale(row);
}

export function getSale(id: string): Sale | null {
  const row = getDb().prepare(`SELECT * FROM sales WHERE id = ?`).get(id) as SaleRow | undefined;
  return row ? rowToSale(row) : null;
}

export function getSaleByStripeSubscriptionId(subscriptionId: string): Sale | null {
  const row = getDb().prepare(`SELECT * FROM sales WHERE stripe_subscription_id = ?`).get(subscriptionId) as
    | SaleRow
    | undefined;
  return row ? rowToSale(row) : null;
}

/** Called from webhook events that report a subscription's current state (renewal, plan change,
 * payment failure, cancellation) — keeps the seller's own record in sync so the dashboard shows
 * accurate status, and so a client's next license refresh call reads the right paid-through date. */
export function updateSubscriptionState(
  subscriptionId: string,
  update: { subscriptionStatus: SubscriptionStatus; currentPeriodEnd?: string | null }
): void {
  const db = getDb();
  if (update.currentPeriodEnd !== undefined) {
    db.prepare(`UPDATE sales SET subscription_status = ?, current_period_end = ? WHERE stripe_subscription_id = ?`).run(
      update.subscriptionStatus,
      update.currentPeriodEnd,
      subscriptionId
    );
  } else {
    db.prepare(`UPDATE sales SET subscription_status = ? WHERE stripe_subscription_id = ?`).run(
      update.subscriptionStatus,
      subscriptionId
    );
  }
}

export function listSales(): Sale[] {
  return (getDb().prepare(`SELECT * FROM sales ORDER BY created_at DESC`).all() as SaleRow[]).map(rowToSale);
}

/** Used by the paid key-recovery flow to confirm (before charging) that this email actually
 * bought a lifetime license — case-insensitive since Stripe Checkout doesn't normalize case. */
export function findLatestLifetimeSaleByEmail(email: string): Sale | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM sales WHERE product_type = 'lifetime' AND lower(customer_email) = lower(?) ORDER BY created_at DESC LIMIT 1`
    )
    .get(email) as SaleRow | undefined;
  return row ? rowToSale(row) : null;
}
