import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "crypto";
import { getSetting } from "./db";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;

// scrypt is deliberately expensive — memoize the derived key for the life of the process instead
// of re-running the KDF on every single vaultEncrypt/vaultDecrypt call (every credential read,
// every SSH session, every Proxmox/router API call goes through here).
let cachedKey: Buffer | null = null;

function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;

  const secret = process.env.VAULT_MASTER_KEY;
  if (!secret || secret.length < 16) {
    throw new Error(
      "VAULT_MASTER_KEY manquant ou trop court. Définis un secret long et aléatoire dans les variables d'environnement (jamais dans le repo)."
    );
  }
  // An explicit env override always wins (an operator who's set this deliberately knows what
  // they're doing). Otherwise use the salt pinned in `settings` at first boot — see
  // ensureVaultKdfSalt() in db.ts for why this can't just be a fixed literal in the code: that
  // would mean every install sharing the same default salt, letting an attacker who steals one
  // install's DB reuse offline dictionary work against every other install still on the default.
  const salt = process.env.VAULT_KDF_SALT || getSetting("vault_kdf_salt") || "homelab-panel-vault";
  cachedKey = scryptSync(secret, salt, KEY_LEN);
  return cachedKey;
}

/** Encrypts a UTF-8 string. Returns a single base64 blob: iv|authTag|ciphertext. */
export function vaultEncrypt(plaintext: string): string {
  const key = getMasterKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function vaultDecrypt(blob: string): string {
  const key = getMasterKey();
  const raw = Buffer.from(blob, "base64");
  const iv = raw.subarray(0, IV_LEN);
  const authTag = raw.subarray(IV_LEN, IV_LEN + 16);
  const ciphertext = raw.subarray(IV_LEN + 16);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
