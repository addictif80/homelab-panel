import { generateKeyPairSync, sign, createPrivateKey, KeyObject } from "crypto";
import { getDb } from "../db";
import { vaultEncrypt, vaultDecrypt } from "../crypto";

type SigningKeyRow = { public_key_pem: string; private_key_pem_encrypted: string };

/**
 * One Ed25519 keypair for the whole seller install, generated once. The private key never
 * leaves this table (encrypted at rest like everything else in the vault) and is never shipped
 * to a buyer — only the public key goes out, embedded in license.json, so a client can verify a
 * signature locally without being able to produce one.
 */
function getOrCreateSigningKeypair(): { publicKeyPem: string; privateKey: KeyObject } {
  const row = getDb().prepare(`SELECT * FROM license_signing_key WHERE id = 1`).get() as SigningKeyRow | undefined;
  if (row) {
    return {
      publicKeyPem: row.public_key_pem,
      privateKey: createPrivateKey({ key: vaultDecrypt(row.private_key_pem_encrypted), format: "pem" }),
    };
  }

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  getDb()
    .prepare(`INSERT INTO license_signing_key (id, public_key_pem, private_key_pem_encrypted) VALUES (1, ?, ?)`)
    .run(publicKeyPem, vaultEncrypt(privateKeyPem));

  return { publicKeyPem, privateKey };
}

export function getSigningPublicKeyPem(): string {
  return getOrCreateSigningKeypair().publicKeyPem;
}

export type LicenseCertificate = { payload: string; signature: string };

/** Signs a license activation payload. The client stores both fields verbatim and re-verifies
 * the signature against the embedded public key on every check — a hand-edited "activated" flag
 * with no matching signature is rejected. */
export function signLicensePayload(payload: Record<string, unknown>): LicenseCertificate {
  const { privateKey } = getOrCreateSigningKeypair();
  const payloadStr = JSON.stringify(payload);
  const signature = sign(null, Buffer.from(payloadStr, "utf8"), privateKey).toString("base64");
  return { payload: payloadStr, signature };
}
