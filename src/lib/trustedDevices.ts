import { randomBytes, createHash } from "crypto";
import { getDb } from "./db";

export const TRUSTED_DEVICE_COOKIE_NAME = "homelab_trusted_device";
const TRUST_DAYS = 30;
export const TRUSTED_DEVICE_MAX_AGE = TRUST_DAYS * 24 * 60 * 60;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Skipping 2FA here never skips the password — this cookie only shortens the second factor for
 * a browser that already proved it once, so a leaked cookie alone still isn't enough to log in.
 * Only the hash is stored (like a password), so a database read can't be turned into a usable
 * cookie value.
 */
export function createTrustedDevice(username: string, label?: string): string {
  const token = randomBytes(32).toString("hex");
  const id = randomBytes(8).toString("hex");
  const expiresAt = new Date(Date.now() + TRUST_DAYS * 24 * 60 * 60 * 1000).toISOString();
  getDb()
    .prepare(`INSERT INTO trusted_devices (id, username, token_hash, label, expires_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id, username, hashToken(token), label || null, expiresAt);
  return token;
}

export function isTrustedDevice(username: string, token: string | undefined): boolean {
  if (!token) return false;
  const row = getDb()
    .prepare(`SELECT id, expires_at FROM trusted_devices WHERE username = ? AND token_hash = ?`)
    .get(username, hashToken(token)) as { id: string; expires_at: string } | undefined;
  if (!row) return false;
  if (new Date(`${row.expires_at}Z`).getTime() < Date.now()) return false;

  getDb().prepare(`UPDATE trusted_devices SET last_used_at = datetime('now') WHERE id = ?`).run(row.id);
  return true;
}

export type TrustedDevice = {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
};

type TrustedDeviceRow = {
  id: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
};

export function listTrustedDevices(username: string): TrustedDevice[] {
  return (
    getDb().prepare(`SELECT * FROM trusted_devices WHERE username = ? ORDER BY created_at DESC`).all(username) as
      TrustedDeviceRow[]
  ).map((r) => ({ id: r.id, label: r.label, createdAt: r.created_at, lastUsedAt: r.last_used_at, expiresAt: r.expires_at }));
}

export function revokeTrustedDevice(username: string, id: string): void {
  getDb().prepare(`DELETE FROM trusted_devices WHERE id = ? AND username = ?`).run(id, username);
}

export function revokeAllTrustedDevices(username: string): void {
  getDb().prepare(`DELETE FROM trusted_devices WHERE username = ?`).run(username);
}
