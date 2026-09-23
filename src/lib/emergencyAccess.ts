import { randomBytes, randomInt, createHash, timingSafeEqual } from "crypto";
import { getDb, logAudit } from "./db";
import { vaultEncrypt, vaultDecrypt } from "./crypto";
import { hashPassword, verifyPassword } from "./auth";
import { createUser } from "./users";
import { buildOtpAuthQrDataUrl } from "./totp";
import { sendMail } from "./mail";
import { resolvePublicUrl } from "./seller/publicUrl";

// Kept short and human-typeable-adjacent isn't the goal here — this is a one-time password sent
// by email and typed once, so entropy wins over convenience.
const TEMP_PASSWORD_LENGTH = 20;
const ACTIVATION_DELAY_HOURS = 48;
const MAX_ATTEMPTS_PER_HOUR = 5;
const ACTIVATION_POLL_INTERVAL_MS = 10 * 60_000;

export type TrustedContactInfo = {
  configured: boolean;
  firstName: string;
  lastName: string;
  birthDate: string;
  email: string;
  question1: string;
  question2: string;
  question3: string;
};

type TrustedContactRow = {
  first_name_encrypted: string;
  last_name_encrypted: string;
  birth_date_encrypted: string;
  email_encrypted: string;
  question1: string;
  answer1_hash: string;
  question2: string;
  answer2_hash: string;
  question3: string;
  answer3_hash: string;
};

function getRow(): TrustedContactRow | undefined {
  return getDb().prepare(`SELECT * FROM trusted_contact WHERE id = 1`).get() as TrustedContactRow | undefined;
}

/** Never returns the answer hashes — this is read by the admin's own settings page, and there's
 * no legitimate reason for even the account owner to see stored answers again (if they're
 * forgotten, the fix is setting new ones, exactly like a password). */
export function getTrustedContact(): TrustedContactInfo | null {
  const row = getRow();
  if (!row) return null;
  return {
    configured: true,
    firstName: vaultDecrypt(row.first_name_encrypted),
    lastName: vaultDecrypt(row.last_name_encrypted),
    birthDate: vaultDecrypt(row.birth_date_encrypted),
    email: vaultDecrypt(row.email_encrypted),
    question1: row.question1,
    question2: row.question2,
    question3: row.question3,
  };
}

export function setTrustedContact(input: {
  firstName: string;
  lastName: string;
  birthDate: string;
  email: string;
  question1: string;
  answer1: string;
  question2: string;
  answer2: string;
  question3: string;
  answer3: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO trusted_contact
         (id, first_name_encrypted, last_name_encrypted, birth_date_encrypted, email_encrypted,
          question1, answer1_hash, question2, answer2_hash, question3, answer3_hash, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         first_name_encrypted = excluded.first_name_encrypted,
         last_name_encrypted = excluded.last_name_encrypted,
         birth_date_encrypted = excluded.birth_date_encrypted,
         email_encrypted = excluded.email_encrypted,
         question1 = excluded.question1, answer1_hash = excluded.answer1_hash,
         question2 = excluded.question2, answer2_hash = excluded.answer2_hash,
         question3 = excluded.question3, answer3_hash = excluded.answer3_hash,
         updated_at = datetime('now')`
    )
    .run(
      vaultEncrypt(input.firstName.trim()),
      vaultEncrypt(input.lastName.trim()),
      vaultEncrypt(input.birthDate.trim()),
      vaultEncrypt(input.email.trim()),
      input.question1.trim(),
      hashPassword(input.answer1.trim().toLowerCase()),
      input.question2.trim(),
      hashPassword(input.answer2.trim().toLowerCase()),
      input.question3.trim(),
      hashPassword(input.answer3.trim().toLowerCase())
    );
  logAudit("emergency_access.contact_configured");
}

export function clearTrustedContact(): void {
  getDb().prepare(`DELETE FROM trusted_contact WHERE id = 1`).run();
  logAudit("emergency_access.contact_removed");
}

/** Public — just the question text, no identity fields, for the trigger form. Null when nothing
 * is configured (the form has nothing to show; the feature is effectively off). */
export function getPublicQuestions(): { question1: string; question2: string; question3: string } | null {
  const row = getRow();
  if (!row) return null;
  return { question1: row.question1, question2: row.question2, question3: row.question3 };
}

function isRateLimited(ip: string): boolean {
  const row = getDb()
    .prepare(`SELECT COUNT(*) as c FROM emergency_access_attempts WHERE ip = ? AND created_at > datetime('now', '-1 hour')`)
    .get(ip) as { c: number };
  return row.c >= MAX_ATTEMPTS_PER_HOUR;
}

function recordAttempt(ip: string, success: boolean): void {
  getDb().prepare(`INSERT INTO emergency_access_attempts (ip, success) VALUES (?, ?)`).run(ip, success ? 1 : 0);
  // Same opportunistic prune as login_attempts (auth.ts) — nothing past the rate-limit window is
  // ever read again.
  getDb().prepare(`DELETE FROM emergency_access_attempts WHERE created_at < datetime('now', '-2 hours')`).run();
}

function normalizeText(s: string): string {
  return s.trim().toLowerCase();
}

export class EmergencyAccessError extends Error {}

/**
 * Verifies identity fields + all three answers against what's on file. On a full match, creates a
 * pending request (not immediate access — see ACTIVATION_DELAY_HOURS) and emails both the trusted
 * contact (confirmation) and the account owner's own address, if one is on file (settings →
 * Comptes), with a cancel link. A generic failure message either way — which field was wrong is
 * never revealed, the same reasoning as a login form never confirming "that username exists".
 */
export async function triggerEmergencyAccess(
  input: {
    firstName: string;
    lastName: string;
    birthDate: string;
    email: string;
    answer1: string;
    answer2: string;
    answer3: string;
  },
  ip: string,
  origin: string
): Promise<void> {
  if (isRateLimited(ip)) {
    throw new EmergencyAccessError("Trop de tentatives. Réessaie dans une heure.");
  }

  const contact = getTrustedContact();
  const row = getRow();
  if (!contact || !row) {
    recordAttempt(ip, false);
    throw new EmergencyAccessError("Informations incorrectes.");
  }

  const identityMatches =
    normalizeText(input.firstName) === normalizeText(contact.firstName) &&
    normalizeText(input.lastName) === normalizeText(contact.lastName) &&
    input.birthDate.trim() === contact.birthDate.trim() &&
    normalizeText(input.email) === normalizeText(contact.email);

  const answersMatch =
    verifyPassword(normalizeText(input.answer1), row.answer1_hash) &&
    verifyPassword(normalizeText(input.answer2), row.answer2_hash) &&
    verifyPassword(normalizeText(input.answer3), row.answer3_hash);

  if (!identityMatches || !answersMatch) {
    recordAttempt(ip, false);
    logAudit("emergency_access.attempt_failed", undefined, ip);
    throw new EmergencyAccessError("Informations incorrectes.");
  }

  recordAttempt(ip, true);

  const existing = getDb().prepare(`SELECT id FROM emergency_access_requests WHERE status = 'pending'`).get();
  if (existing) {
    // Already in motion — don't reset the clock or spam a second round of emails just because the
    // same (legitimate) person filled the form again.
    logAudit("emergency_access.attempt_duplicate", undefined, ip);
    return;
  }

  const id = randomBytes(16).toString("hex");
  const cancelToken = randomBytes(32).toString("hex");
  const cancelTokenHash = createHash("sha256").update(cancelToken).digest("hex");
  const activatesAt = new Date(Date.now() + ACTIVATION_DELAY_HOURS * 3_600_000).toISOString();

  getDb()
    .prepare(`INSERT INTO emergency_access_requests (id, status, activates_at, cancel_token_hash) VALUES (?, 'pending', ?, ?)`)
    .run(id, activatesAt, cancelTokenHash);

  logAudit("emergency_access.triggered", id, ip);

  const publicUrl = resolvePublicUrl(origin);
  const cancelUrl = `${publicUrl}/emergency-access/cancel?token=${cancelToken}`;
  const activatesAtFr = new Date(activatesAt).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });

  await sendMail(
    "⚠️ Demande d'accès d'urgence déclenchée sur ton Homelab Panel",
    `Une demande d'accès d'urgence vient d'être déclenchée sur ton Homelab Panel par la personne que tu as désignée comme contact de confiance.\n\n` +
      `Si c'est normal (tu es indisponible et tu as autorisé cette démarche), tu n'as rien à faire : l'accès sera activé le ${activatesAtFr} (délai de sécurité de ${ACTIVATION_DELAY_HOURS}h).\n\n` +
      `Si ce n'est PAS toi ou pas prévu, annule immédiatement en cliquant ici :\n${cancelUrl}\n\n` +
      `Passé ce délai, un nouveau compte administrateur sera créé pour ton contact de confiance, et ton propre compte sera suspendu jusqu'à ce qu'il/elle le débloque.`,
    contact.email // fallback recipient if the admin has none configured — see note below
  ).catch(() => {});

  // Best-effort, separate from the call above: the *real* target for this warning is the account
  // owner, not the trusted contact — sent to every admin account that has an email on file (2FA
  // email, reused here since it's already the "how do I reach this person" field this app has).
  const adminEmails = (
    getDb().prepare(`SELECT email FROM users WHERE role = 'admin' AND email IS NOT NULL AND is_trusted_contact = 0`).all() as {
      email: string;
    }[]
  ).map((r) => r.email);
  for (const email of adminEmails) {
    await sendMail(
      "⚠️ Demande d'accès d'urgence déclenchée sur ton Homelab Panel",
      `Quelqu'un ayant répondu correctement à tes questions de sécurité vient de déclencher la procédure d'accès d'urgence.\n\n` +
        `Si c'est prévu, ignore ce message : l'accès sera activé le ${activatesAtFr}.\n\n` +
        `Si ce n'est pas toi qui l'as autorisé, annule immédiatement :\n${cancelUrl}`,
      email
    ).catch(() => {});
  }

  await sendMail(
    "Ta demande d'accès a bien été reçue",
    `Tes réponses ont été vérifiées. Pour des raisons de sécurité, l'accès n'est pas immédiat : ` +
      `il sera activé le ${activatesAtFr} si personne ne l'annule d'ici là.\n\n` +
      `Tu recevras un second email à ce moment-là avec tes identifiants de connexion.`,
    contact.email
  ).catch(() => {});
}

export async function cancelEmergencyAccess(token: string): Promise<boolean> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const pending = getDb().prepare(`SELECT id, cancel_token_hash FROM emergency_access_requests WHERE status = 'pending'`).all() as {
    id: string;
    cancel_token_hash: string;
  }[];

  for (const row of pending) {
    const a = Buffer.from(row.cancel_token_hash, "hex");
    const b = Buffer.from(tokenHash, "hex");
    if (a.length === b.length && timingSafeEqual(a, b)) {
      getDb().prepare(`UPDATE emergency_access_requests SET status = 'cancelled' WHERE id = ?`).run(row.id);
      logAudit("emergency_access.cancelled", row.id);
      return true;
    }
  }
  return false;
}

function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from({ length: TEMP_PASSWORD_LENGTH }, () => alphabet[randomInt(alphabet.length)]).join("");
}

function slugifyUsername(firstName: string, lastName: string): string {
  const base = `${firstName}.${lastName}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9.]/g, "");
  let candidate = base || "contact-urgence";
  let suffix = 0;
  while (getDb().prepare(`SELECT 1 FROM users WHERE username = ?`).get(candidate)) {
    suffix += 1;
    candidate = `${base}${suffix}`;
  }
  return candidate;
}

/**
 * Runs an activation that has cleared its 48h window: creates the trusted contact a fresh admin
 * account (with its own TOTP secret, emailed as a QR code — same enrollment path as any other new
 * account, see lib/users.ts's createUser), locks every other account so the transfer of control is
 * exclusive rather than shared, and emails the credentials + a plain-language "what now" guide.
 */
async function activateOne(requestId: string): Promise<void> {
  const contact = getTrustedContact();
  if (!contact) {
    // The contact was removed after the request was created — nothing sane to activate into.
    getDb().prepare(`UPDATE emergency_access_requests SET status = 'cancelled' WHERE id = ?`).run(requestId);
    return;
  }

  const username = slugifyUsername(contact.firstName, contact.lastName);
  const password = generateTempPassword();
  const { qrDataUrl, secret } = await createUser({ username, password, role: "admin", email: contact.email });
  getDb().prepare(`UPDATE users SET is_trusted_contact = 1 WHERE username = ?`).run(username);

  getDb().prepare(`UPDATE users SET locked = 1 WHERE is_trusted_contact = 0`).run();

  getDb()
    .prepare(`UPDATE emergency_access_requests SET status = 'completed', new_username = ?, completed_at = datetime('now') WHERE id = ?`)
    .run(username, requestId);

  logAudit("emergency_access.activated", requestId, username);

  // No request context here (this runs off the activation scheduler, not an HTTP handler) — relies
  // entirely on the "URL publique du panel" setting (Réglages) being configured, same requirement
  // the Stripe webhook/download links elsewhere already have. Falls back to an empty string (a
  // relative-looking, broken link) rather than guessing at a hostname if it isn't set.
  const publicUrl = resolvePublicUrl("");
  const activateUrl = `${publicUrl}/emergency-access/finish-setup?username=${encodeURIComponent(username)}`;

  await sendMail(
    "Ton accès au Homelab Panel est activé",
    `Voici tes identifiants :\n\nNom d'utilisateur : ${username}\nMot de passe : ${password}\n\n` +
      `Avant de pouvoir te connecter, il faut activer la double authentification (obligatoire, comme pour tout compte) :\n` +
      `1. Installe une application d'authentification sur ton téléphone (Google Authenticator, Authy...).\n` +
      `2. Ouvre ce lien et scanne le QR code avec l'application : ${activateUrl}\n` +
      `   (si le QR code ne s'affiche pas dans cet email, utilise ce code à saisir à la main dans l'application : ${secret})\n` +
      `3. Entre le code à 6 chiffres affiché par l'application pour confirmer.\n` +
      `4. Connecte-toi sur ${publicUrl}/login avec le nom d'utilisateur et le mot de passe ci-dessus.\n\n` +
      `Une fois connecté(e), va dans la section "Aide — Accès d'urgence" du panel : elle explique, sans connaissances techniques, ` +
      `comment vérifier que tout va bien et quoi faire en premier.`,
    contact.email,
    `<p>Voici tes identifiants :</p>
     <p><b>Nom d'utilisateur :</b> ${username}<br><b>Mot de passe :</b> ${password}</p>
     <p>Avant de pouvoir te connecter, active la double authentification (obligatoire) :</p>
     <ol>
       <li>Installe une application d'authentification (Google Authenticator, Authy...).</li>
       <li>Scanne ce QR code avec l'application :</li>
     </ol>
     <p><img src="${qrDataUrl}" alt="QR code" width="180" height="180"></p>
     <p>Si le QR code ne s'affiche pas, saisis ce code à la main dans l'application : <code>${secret}</code></p>
     <p>Puis entre le code à 6 chiffres généré <a href="${activateUrl}">ici</a> pour confirmer, et connecte-toi sur
     <a href="${publicUrl}/login">${publicUrl}/login</a>.</p>
     <p>Une fois connecté(e), la section "Aide — Accès d'urgence" du panel explique, sans connaissances techniques,
     quoi faire en premier.</p>`
  ).catch(() => {});

  const adminEmails = (
    getDb().prepare(`SELECT email FROM users WHERE is_trusted_contact = 0 AND email IS NOT NULL`).all() as { email: string }[]
  ).map((r) => r.email);
  for (const email of adminEmails) {
    await sendMail(
      "L'accès d'urgence a été activé",
      `Le délai de sécurité de ${ACTIVATION_DELAY_HOURS}h est passé sans annulation. Un compte administrateur a été créé ` +
        `pour ton contact de confiance, et ton propre compte a été suspendu — seul ce nouveau compte peut le débloquer, ` +
        `depuis Comptes.`,
      email
    ).catch(() => {});
  }
}

async function processActivations(): Promise<void> {
  const due = getDb()
    .prepare(`SELECT id FROM emergency_access_requests WHERE status = 'pending' AND activates_at <= datetime('now')`)
    .all() as { id: string }[];
  for (const row of due) {
    await activateOne(row.id).catch(() => {});
  }
}

let started = false;
export function startEmergencyAccessScheduler(): void {
  if (started) return;
  started = true;
  processActivations().catch(() => {});
  setInterval(() => processActivations().catch(() => {}), ACTIVATION_POLL_INTERVAL_MS);
}
