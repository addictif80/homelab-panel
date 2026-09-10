import { getDb } from "./db";
import { hashPassword, type UserRole } from "./auth";
import { generateTotpSecret, encryptTotpSecret, buildOtpAuthQrDataUrl } from "./totp";

export type UserSummary = {
  id: number;
  username: string;
  role: UserRole;
  totpEnabled: boolean;
  createdAt: string;
};

type UserRow = {
  id: number;
  username: string;
  role: UserRole;
  totp_enabled: number;
  created_at: string;
};

export function listUsers(): UserSummary[] {
  return (
    getDb()
      .prepare(`SELECT id, username, role, totp_enabled, created_at FROM users ORDER BY created_at ASC`)
      .all() as UserRow[]
  ).map((r) => ({
    id: r.id,
    username: r.username,
    role: r.role,
    totpEnabled: !!r.totp_enabled,
    createdAt: r.created_at,
  }));
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
}): Promise<{ qrDataUrl: string; secret: string }> {
  const totpSecret = generateTotpSecret();
  const passwordHash = hashPassword(input.password);

  getDb()
    .prepare(
      `INSERT INTO users (username, password_hash, totp_secret_encrypted, totp_enabled, role) VALUES (?, ?, ?, 0, ?)`
    )
    .run(input.username, passwordHash, encryptTotpSecret(totpSecret), input.role);

  const qrDataUrl = await buildOtpAuthQrDataUrl(input.username, totpSecret);
  return { qrDataUrl, secret: totpSecret };
}

export function deleteUser(id: number): void {
  getDb().prepare(`DELETE FROM users WHERE id = ?`).run(id);
}

export function setUserRole(id: number, role: UserRole): void {
  getDb().prepare(`UPDATE users SET role = ? WHERE id = ?`).run(role, id);
}
