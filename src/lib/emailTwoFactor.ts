import { randomInt, createHash } from "crypto";
import { getDb } from "./db";
import { sendMail, getSmtpConfig } from "./mail";

// A short numeric code emailed as an alternative second factor, for anyone who'd rather not (or
// can't) use the authenticator app on a given login — the TOTP secret stays the primary method,
// this is purely additive. Hashed at rest like a password, not stored in plaintext, even though
// it's short-lived and single-use: the DB file itself could be copied off the box in a backup.
const CODE_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 45;

function hashCode(username: string, code: string): string {
  // Salted with the username so two accounts that happen to draw the same 6-digit code don't
  // collide in the hash column — not a security boundary (the code is single-use and short-lived
  // regardless), just avoids a confusing implementation detail.
  return createHash("sha256").update(`${username}:${code}`).digest("hex");
}

type CodeRow = { code_hash: string; expires_at: string; consumed: number; created_at: string };

/** True if email 2FA is actually usable right now: SMTP configured and enabled, and this account
 * has an address on file. Checked before showing the "send by email" option at all. */
export function canSendEmailCode(email: string | null): boolean {
  if (!email) return false;
  const config = getSmtpConfig();
  return !!config?.enabled;
}

export class EmailCodeCooldownError extends Error {}

/** Generates a fresh code, replacing any previous one for this username, and emails it to
 * `email`. Throws EmailCodeCooldownError if one was already sent too recently (rather than
 * silently no-op'ing, so the UI can show a clear "attends encore Xs" instead of a code that never
 * arrives because it collided with a still-cooling-down one). */
export async function sendEmailLoginCode(username: string, email: string): Promise<void> {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM email_login_codes WHERE username = ?`).get(username) as
    | CodeRow
    | undefined;
  if (existing) {
    const ageSeconds = (Date.now() - new Date(`${existing.created_at}Z`).getTime()) / 1000;
    if (ageSeconds < RESEND_COOLDOWN_SECONDS) {
      throw new EmailCodeCooldownError(
        `Un code a déjà été envoyé il y a moins d'une minute. Réessaie dans ${Math.ceil(RESEND_COOLDOWN_SECONDS - ageSeconds)}s.`
      );
    }
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString();

  db.prepare(
    `INSERT INTO email_login_codes (username, code_hash, expires_at, consumed, created_at)
     VALUES (?, ?, ?, 0, datetime('now'))
     ON CONFLICT(username) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
       consumed = 0, created_at = excluded.created_at`
  ).run(username, hashCode(username, code), expiresAt);

  await sendMail(
    "Ton code de connexion Homelab Panel",
    `Ton code de connexion est : ${code}\n\nIl expire dans ${CODE_TTL_MINUTES} minutes et ne peut servir qu'une fois. Si tu n'es pas à l'origine de cette demande, ignore cet email.`,
    email
  );
}

/** Consumes the pending code for `username` if `code` matches and it hasn't expired or already
 * been used. Same call whether it succeeds or fails — a wrong code doesn't get a second try
 * against the same hash, it has to be re-requested. */
export function verifyEmailLoginCode(username: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const db = getDb();
  const row = db.prepare(`SELECT * FROM email_login_codes WHERE username = ?`).get(username) as CodeRow | undefined;
  if (!row || row.consumed) return false;
  // expires_at is written as a JS ISO string (already UTC, already carries "Z") — unlike
  // created_at/expires_at columns elsewhere in this codebase that come from SQLite's
  // datetime('now') and need a "Z" appended before parsing, this one must not get a second one.
  if (new Date(row.expires_at).getTime() < Date.now()) return false;
  if (row.code_hash !== hashCode(username, code)) return false;

  db.prepare(`UPDATE email_login_codes SET consumed = 1 WHERE username = ?`).run(username);
  return true;
}
