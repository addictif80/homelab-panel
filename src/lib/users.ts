import { getDb } from "./db";
import { hashPassword, type UserRole } from "./auth";
import { generateTotpSecret, encryptTotpSecret, buildOtpAuthQrDataUrl } from "./totp";

export type UserSummary = {
  id: number;
  username: string;
  email: string | null;
  role: UserRole;
  totpEnabled: boolean;
  locked: boolean;
  isTrustedContact: boolean;
  createdAt: string;
};

type UserRow = {
  id: number;
  username: string;
  email: string | null;
  role: UserRole;
  totp_enabled: number;
  locked: number;
  is_trusted_contact: number;
  created_at: string;
};

export function listUsers(): UserSummary[] {
  return (
    getDb()
      .prepare(`SELECT id, username, email, role, totp_enabled, locked, is_trusted_contact, created_at FROM users ORDER BY created_at ASC`)
      .all() as UserRow[]
  ).map((r) => ({
    id: r.id,
    username: r.username,
    email: r.email,
    role: r.role,
    totpEnabled: !!r.totp_enabled,
    locked: !!r.locked,
    isTrustedContact: !!r.is_trusted_contact,
    createdAt: r.created_at,
  }));
}

export function setUserLocked(id: number, locked: boolean): void {
  getDb().prepare(`UPDATE users SET locked = ? WHERE id = ?`).run(locked ? 1 : 0, id);
}

export function setUserEmail(id: number, email: string | null): void {
  getDb().prepare(`UPDATE users SET email = ? WHERE id = ?`).run(email || null, id);
}

export function countAdmins(): number {
  const row = getDb().prepare(`SELECT COUNT(*) as c FROM users WHERE role = 'admin'`).get() as { c: number };
  return row.c;
}

export function getUserRoleById(id: number): UserRole | null {
  const row = getDb().prepare(`SELECT role FROM users WHERE id = ?`).get(id) as { role: UserRole } | undefined;
  return row?.role ?? null;
}

/**
 * Creates a viewer/admin account and returns its TOTP QR/secret once, the same way the initial
 * setup flow does — the admin relays it to the new user out of band (there's no email system
 * here), and the account can't log in until that person scans it and confirms via
 * /api/auth/setup/verify, which already works for any account regardless of how it was created.
 */
export async function createUser(input: {
  username: string;
  password: string;
  role: UserRole;
  email?: string;
}): Promise<{ qrDataUrl: string; secret: string }> {
  const totpSecret = generateTotpSecret();
  const passwordHash = hashPassword(input.password);

  getDb()
    .prepare(
      `INSERT INTO users (username, password_hash, totp_secret_encrypted, totp_enabled, role, email) VALUES (?, ?, ?, 0, ?, ?)`
    )
    .run(input.username, passwordHash, encryptTotpSecret(totpSecret), input.role, input.email || null);

  const qrDataUrl = await buildOtpAuthQrDataUrl(input.username, totpSecret);
  return { qrDataUrl, secret: totpSecret };
}

export function deleteUser(id: number): void {
  getDb().prepare(`DELETE FROM users WHERE id = ?`).run(id);
}

export function setUserRole(id: number, role: UserRole): void {
  getDb().prepare(`UPDATE users SET role = ? WHERE id = ?`).run(role, id);
}
