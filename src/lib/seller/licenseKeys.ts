import { randomBytes } from "crypto";
import { getDb } from "../db";

export type LicenseKey = {
  key: string;
  saleId: string;
  createdAt: string;
  usedAt: string | null;
  usedByInfo: string | null;
};

type KeyRow = {
  key: string;
  sale_id: string;
  created_at: string;
  used_at: string | null;
  used_by_info: string | null;
  instance_id: string | null;
};

function rowToKey(row: KeyRow): LicenseKey {
  return { key: row.key, saleId: row.sale_id, createdAt: row.created_at, usedAt: row.used_at, usedByInfo: row.used_by_info };
}

export type LicenseKeyWithOrigin = LicenseKey & { amountCents: number; saleNotes: string | null; customerEmail: string };

/** Same as listLicenseKeys() but joined with the originating sale — lets the seller UI tell a real
 * purchase apart from a manually-generated key (amountCents === 0 and, usually, a note explaining
 * why) without a separate lookup per row. */
export function listLicenseKeysWithOrigin(): LicenseKeyWithOrigin[] {
  const rows = getDb()
    .prepare(
      `SELECT k.*, s.amount_cents, s.notes as sale_notes, s.customer_email
       FROM license_keys k JOIN sales s ON s.id = k.sale_id
       ORDER BY k.created_at DESC`
    )
    .all() as (KeyRow & { amount_cents: number; sale_notes: string | null; customer_email: string })[];
  return rows.map((row) => ({
    ...rowToKey(row),
    amountCents: row.amount_cents,
    saleNotes: row.sale_notes,
    customerEmail: row.customer_email,
  }));
}

function generateKey(): string {
  const chunk = () => randomBytes(2).toString("hex").toUpperCase();
  return `HLP-${chunk()}-${chunk()}-${chunk()}-${chunk()}`;
}

export function createLicenseKey(saleId: string): LicenseKey {
  const key = generateKey();
  getDb().prepare(`INSERT INTO license_keys (key, sale_id) VALUES (?, ?)`).run(key, saleId);
  return { key, saleId, createdAt: new Date().toISOString(), usedAt: null, usedByInfo: null };
}

export function getSaleIdForKey(key: string): string | null {
  const row = getDb().prepare(`SELECT sale_id FROM license_keys WHERE key = ?`).get(key) as { sale_id: string } | undefined;
  return row?.sale_id ?? null;
}

export function getLicenseKeyForSale(saleId: string): LicenseKey | null {
  const row = getDb().prepare(`SELECT * FROM license_keys WHERE sale_id = ? ORDER BY created_at DESC LIMIT 1`).get(saleId) as
    | KeyRow
    | undefined;
  return row ? rowToKey(row) : null;
}

export function listLicenseKeys(): LicenseKey[] {
  return (getDb().prepare(`SELECT * FROM license_keys ORDER BY created_at DESC`).all() as KeyRow[]).map(rowToKey);
}

export type ValidateResult = { valid: true } | { valid: false; error: string };

/**
 * First-use-wins: the UPDATE only succeeds while used_at is still NULL, so two concurrent
 * activation attempts for the same key can't both win — whichever commits first consumes it,
 * the other sees 0 rows affected and is rejected. This is the actual "one key, one use"
 * enforcement point, not just a check-then-write that a race could slip through.
 *
 * `instanceId` (the caller's locally-generated, persisted install ID) is bound here at first
 * activation — /api/seller/license/refresh later requires a matching instanceId before it will
 * re-issue a signed certificate for this key, so knowing the key text alone isn't enough to mint
 * a certificate for a second, unrelated installation.
 */
export function validateAndConsumeKey(key: string, instanceInfo?: string, instanceId?: string): ValidateResult {
  const row = getDb().prepare(`SELECT * FROM license_keys WHERE key = ?`).get(key) as KeyRow | undefined;
  if (!row) return { valid: false, error: "Clé inconnue." };
  if (row.used_at) return { valid: false, error: "Cette clé a déjà été utilisée." };

  const result = getDb()
    .prepare(
      `UPDATE license_keys SET used_at = datetime('now'), used_by_info = ?, instance_id = ? WHERE key = ? AND used_at IS NULL`
    )
    .run(instanceInfo || null, instanceId || null, key);

  if (result.changes === 0) {
    return { valid: false, error: "Cette clé a déjà été utilisée." };
  }
  return { valid: true };
}

/** Used by /api/seller/license/refresh to check the caller's instanceId against the one bound at
 * activation, before re-issuing a signed certificate for an already-used key. */
export function getKeyInstanceBinding(key: string): { usedAt: string | null; instanceId: string | null } | null {
  const row = getDb().prepare(`SELECT used_at, instance_id FROM license_keys WHERE key = ?`).get(key) as
    | { used_at: string | null; instance_id: string | null }
    | undefined;
  return row ? { usedAt: row.used_at, instanceId: row.instance_id } : null;
}

/** Adopts an instanceId for a key that was activated before instance binding existed (instance_id
 * still NULL) — a one-time grandfather step so pre-existing installs bind on their next refresh
 * instead of being locked out. No-op once a binding already exists. */
export function bindKeyInstanceId(key: string, instanceId: string): void {
  getDb().prepare(`UPDATE license_keys SET instance_id = ? WHERE key = ? AND instance_id IS NULL`).run(instanceId, key);
}
