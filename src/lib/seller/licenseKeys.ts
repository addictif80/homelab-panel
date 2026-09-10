import { randomBytes } from "crypto";
import { getDb } from "../db";

export type LicenseKey = {
  key: string;
  saleId: string;
  createdAt: string;
  usedAt: string | null;
  usedByInfo: string | null;
};

type KeyRow = { key: string; sale_id: string; created_at: string; used_at: string | null; used_by_info: string | null };

function rowToKey(row: KeyRow): LicenseKey {
  return { key: row.key, saleId: row.sale_id, createdAt: row.created_at, usedAt: row.used_at, usedByInfo: row.used_by_info };
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
 */
export function validateAndConsumeKey(key: string, instanceInfo?: string): ValidateResult {
  const row = getDb().prepare(`SELECT * FROM license_keys WHERE key = ?`).get(key) as KeyRow | undefined;
  if (!row) return { valid: false, error: "Clé inconnue." };
  if (row.used_at) return { valid: false, error: "Cette clé a déjà été utilisée." };

  const result = getDb()
    .prepare(`UPDATE license_keys SET used_at = datetime('now'), used_by_info = ? WHERE key = ? AND used_at IS NULL`)
    .run(instanceInfo || null, key);

  if (result.changes === 0) {
    return { valid: false, error: "Cette clé a déjà été utilisée." };
  }
  return { valid: true };
}
