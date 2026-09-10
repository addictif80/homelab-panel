import { randomBytes } from "crypto";
import { getDb } from "../db";

const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export function createDownloadToken(saleId: string): string {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + EXPIRY_MS).toISOString();
  getDb()
    .prepare(`INSERT INTO download_tokens (token, sale_id, expires_at) VALUES (?, ?, ?)`)
    .run(token, saleId, expiresAt);
  return token;
}

type TokenRow = { token: string; sale_id: string; expires_at: string; used_at: string | null };

export type RedeemResult = { ok: true; saleId: string } | { ok: false; error: string };

/** Single-use by design: the very first successful check marks it used, so a second visit to
 * the same link (even the legitimate buyer refreshing the page) is refused. */
export function redeemDownloadToken(token: string): RedeemResult {
  const row = getDb().prepare(`SELECT * FROM download_tokens WHERE token = ?`).get(token) as TokenRow | undefined;
  if (!row) return { ok: false, error: "Ce lien de téléchargement est invalide." };
  if (row.used_at) return { ok: false, error: "Ce lien a déjà été utilisé." };
  if (new Date(`${row.expires_at}Z`).getTime() < Date.now()) {
    return { ok: false, error: "Ce lien a expiré." };
  }
  getDb().prepare(`UPDATE download_tokens SET used_at = datetime('now') WHERE token = ?`).run(token);
  return { ok: true, saleId: row.sale_id };
}
