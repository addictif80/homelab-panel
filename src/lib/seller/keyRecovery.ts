import { randomUUID } from "crypto";
import { getDb, getSetting, setSetting } from "../db";

const ENABLED_SETTING = "key_recovery_enabled";
const PRICE_SETTING = "key_recovery_price_cents";

export type KeyRecoveryConfig = { enabled: boolean; amountCents: number };

/** Paid "I lost my lifetime key" service — off by default, price set by the seller. */
export function getKeyRecoveryConfig(): KeyRecoveryConfig {
  return {
    enabled: getSetting(ENABLED_SETTING) === "true",
    amountCents: Number(getSetting(PRICE_SETTING) || 0),
  };
}

export function setKeyRecoveryConfig(enabled: boolean, amountCents: number): void {
  setSetting(ENABLED_SETTING, enabled ? "true" : "false");
  setSetting(PRICE_SETTING, String(Math.max(0, Math.round(amountCents))));
}

export type KeyRecoveryOrder = {
  id: string;
  stripeSessionId: string;
  email: string;
  amountCents: number;
  currency: string;
  saleId: string | null;
  createdAt: string;
};

type OrderRow = {
  id: string;
  stripe_session_id: string;
  email: string;
  amount_cents: number;
  currency: string;
  sale_id: string | null;
  created_at: string;
};

function rowToOrder(row: OrderRow): KeyRecoveryOrder {
  return {
    id: row.id,
    stripeSessionId: row.stripe_session_id,
    email: row.email,
    amountCents: row.amount_cents,
    currency: row.currency,
    saleId: row.sale_id,
    createdAt: row.created_at,
  };
}

export function keyRecoveryOrderExists(stripeSessionId: string): boolean {
  return !!getDb().prepare(`SELECT 1 FROM key_recovery_orders WHERE stripe_session_id = ?`).get(stripeSessionId);
}

export function recordKeyRecoveryOrder(input: {
  stripeSessionId: string;
  email: string;
  amountCents: number;
  currency: string;
  saleId: string | null;
}): KeyRecoveryOrder {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO key_recovery_orders (id, stripe_session_id, email, amount_cents, currency, sale_id) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, input.stripeSessionId, input.email, input.amountCents, input.currency, input.saleId);
  return rowToOrder(getDb().prepare(`SELECT * FROM key_recovery_orders WHERE id = ?`).get(id) as OrderRow);
}

export function listKeyRecoveryOrders(): KeyRecoveryOrder[] {
  return (getDb().prepare(`SELECT * FROM key_recovery_orders ORDER BY created_at DESC`).all() as OrderRow[]).map(rowToOrder);
}
