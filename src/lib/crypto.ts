import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "crypto";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;

function getMasterKey(): Buffer {
  const secret = process.env.VAULT_MASTER_KEY;
  if (!secret || secret.length < 16) {
    throw new Error(
      "VAULT_MASTER_KEY manquant ou trop court. Définis un secret long et aléatoire dans les variables d'environnement (jamais dans le repo)."
    );
  }
  // Static salt derived from a separate env var keeps the KDF deterministic
  // without storing the salt in the DB alongside every secret.
  const salt = process.env.VAULT_KDF_SALT || "homelab-panel-vault";
  return scryptSync(secret, salt, KEY_LEN);
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
