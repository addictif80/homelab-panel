import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import type { NextRequest } from "next/server";
import { getDb } from "./db";

/** Best-effort caller IP for login-attempt bookkeeping only — never treat this as trustworthy on
 * its own (see MAX_ATTEMPTS_PER_USERNAME below for why the actual lockout doesn't rely on it). */
export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

const SESSION_COOKIE = "homelab_session";
const SESSION_TTL_SECONDS = 60 * 30; // 30 min, refreshed on activity
const MAX_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MINUTES = 15;
// `X-Forwarded-For` is attacker-controlled unless a trusted reverse proxy strips/overwrites it,
// which this app can't assume (self-hosted, no configured trusted-proxy list) — an attacker can
// send a fresh fake IP on every request and get a brand new per-(ip, username) budget each time.
// This second, IP-independent cap closes that bypass: no amount of IP spoofing raises it, since
// it's keyed on the username alone. Higher than MAX_ATTEMPTS so it doesn't add friction for a
// real user who fails a few times from more than one device/network.
const MAX_ATTEMPTS_PER_USERNAME = 20;

function getSessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET manquant ou trop court dans les variables d'environnement.");
  }
  return new TextEncoder().encode(secret);
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
export const SESSION_MAX_AGE = SESSION_TTL_SECONDS;

export async function createSessionToken(username: string): Promise<string> {
  return await new SignJWT({ sub: username })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSessionSecret());
}

export async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret());
    // Pending-2FA tokens are signed with this same secret but must never authenticate a request
    // on their own — only a token with no scope claim is a real, fully-authenticated session.
    if (payload.scope !== undefined) return null;
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 12);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

/** Returns true if this IP/username pair is currently locked out from too many failed attempts. */
export function isLockedOut(ip: string, username: string): boolean {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) as c FROM login_attempts
       WHERE ip = ? AND username = ? AND success = 0
       AND created_at > datetime('now', ?)`
    )
    .get(ip, username, `-${LOCKOUT_WINDOW_MINUTES} minutes`) as { c: number };
  if (row.c >= MAX_ATTEMPTS) return true;

  const perUsername = db
    .prepare(
      `SELECT COUNT(*) as c FROM login_attempts
       WHERE username = ? AND success = 0
       AND created_at > datetime('now', ?)`
    )
    .get(username, `-${LOCKOUT_WINDOW_MINUTES} minutes`) as { c: number };
  return perUsername.c >= MAX_ATTEMPTS_PER_USERNAME;
}

export function recordLoginAttempt(ip: string, username: string, success: boolean) {
  const db = getDb();
  db.prepare(`INSERT INTO login_attempts (ip, username, success) VALUES (?, ?, ?)`).run(
    ip,
    username,
    success ? 1 : 0
  );
  // Nothing past the lockout window is ever read again — prune opportunistically here rather than
  // running a separate scheduled job for a table that otherwise grows forever.
  db.prepare(`DELETE FROM login_attempts WHERE created_at < datetime('now', ?)`).run(
    `-${LOCKOUT_WINDOW_MINUTES * 2} minutes`
  );
}

export type UserRole = "admin" | "viewer";

export type AppUser = {
  id: number;
  username: string;
  password_hash: string;
  totp_secret_encrypted: string | null;
  totp_enabled: number;
  role: UserRole;
};

export function getUserByUsername(username: string): AppUser | undefined {
  return getDb()
    .prepare(`SELECT * FROM users WHERE username = ?`)
    .get(username) as AppUser | undefined;
}

export function getUserRole(username: string): UserRole | null {
  const row = getDb().prepare(`SELECT role FROM users WHERE username = ?`).get(username) as
    | { role: UserRole }
    | undefined;
  return row?.role ?? null;
}

const PENDING_2FA_TTL_SECONDS = 60 * 5;

/** Short-lived token proving password step succeeded, before TOTP is verified. Grants no access. */
export async function createPending2faToken(username: string): Promise<string> {
  return await new SignJWT({ sub: username, scope: "pending-2fa" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${PENDING_2FA_TTL_SECONDS}s`)
    .sign(getSessionSecret());
}

export async function verifyPending2faToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret());
    if (payload.scope !== "pending-2fa" || typeof payload.sub !== "string") return null;
    return payload.sub;
  } catch {
    return null;
  }
}
