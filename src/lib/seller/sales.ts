import { randomUUID } from "crypto";
import { getDb } from "../db";

export type Sale = {
  id: string;
  stripeSessionId: string;
  customerEmail: string;
  amountCents: number;
  currency: string;
  createdAt: string;
};

type SaleRow = {
  id: string;
  stripe_session_id: string;
  customer_email: string;
  amount_cents: number;
  currency: string;
  created_at: string;
};

function rowToSale(row: SaleRow): Sale {
  return {
    id: row.id,
    stripeSessionId: row.stripe_session_id,
    customerEmail: row.customer_email,
    amountCents: row.amount_cents,
    currency: row.currency,
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
}): Sale {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO sales (id, stripe_session_id, customer_email, amount_cents, currency) VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, input.stripeSessionId, input.customerEmail, input.amountCents, input.currency);
  const row = getDb().prepare(`SELECT * FROM sales WHERE id = ?`).get(id) as SaleRow;
  return rowToSale(row);
}

export function getSale(id: string): Sale | null {
  const row = getDb().prepare(`SELECT * FROM sales WHERE id = ?`).get(id) as SaleRow | undefined;
  return row ? rowToSale(row) : null;
}

export function listSales(): Sale[] {
  return (getDb().prepare(`SELECT * FROM sales ORDER BY created_at DESC`).all() as SaleRow[]).map(rowToSale);
}
