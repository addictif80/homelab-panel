import { readFileSync } from "fs";
import path from "path";
import { verify, createPublicKey } from "crypto";
import { getDb } from "./db";

type LicenseConfig = { trialDays: number; licenseServerUrl: string; licensePublicKey: string };

let cachedConfig: LicenseConfig | null = null;

type RawLicenseFile = LicenseConfig & { preActivatedKey?: string };

/**
 * Read once per process from license.json at the project root. The seller's export builder
 * overwrites this file's contents in every zip it produces (trial length, where to validate a
 * key, and the public key used to check an activation's signature) — the version checked into
 * the seller's own repo is just a harmless default.
 */
function readLicenseFile(): RawLicenseFile {
  try {
    const raw = readFileSync(path.join(process.cwd(), "license.json"), "utf8");
    const parsed = JSON.parse(raw);
    return {
      trialDays: Number(parsed.trialDays) || 14,
      licenseServerUrl: typeof parsed.licenseServerUrl === "string" ? parsed.licenseServerUrl : "",
      licensePublicKey: typeof parsed.licensePublicKey === "string" ? parsed.licensePublicKey : "",
      preActivatedKey: typeof parsed.preActivatedKey === "string" ? parsed.preActivatedKey : undefined,
    };
  } catch {
    return { trialDays: 14, licenseServerUrl: "", licensePublicKey: "" };
  }
}

function getLicenseConfig(): LicenseConfig {
  if (!cachedConfig) {
    const { trialDays, licenseServerUrl, licensePublicKey } = readLicenseFile();
    cachedConfig = { trialDays, licenseServerUrl, licensePublicKey };
  }
  return cachedConfig;
}

/** Runs once at server startup: a paid download ships with its own key already embedded, so it
 * activates itself on first boot instead of making the buyer copy-paste anything. */
export async function autoActivateFromBundledKey(): Promise<void> {
  if (isSellerInstance()) return;
  const { preActivatedKey } = readLicenseFile();
  if (!preActivatedKey) return;

  const row = getLicenseRow();
  if (row.status === "activated") return;

  await activateWithKey(preActivatedKey);
}

/**
 * The seller's own deployment is never trial-limited — this flag only exists there.
 * Deliberately NOT a NEXT_PUBLIC_ variable: those get inlined into the client bundle, and since
 * this gates a server-side license decision (not UI), it must stay a plain server-only env var —
 * `SELLER_MODE`, never `NEXT_PUBLIC_SELLER_MODE` — so it can't be set to bypass licensing just by
 * being present in a customer's own build environment under the name a client-facing flag would use.
 */
export function isSellerInstance(): boolean {
  return process.env.SELLER_MODE === "true";
}

type LicenseRow = {
  status: "trial" | "activated";
  trial_started_at: string;
  activation_key: string | null;
  activated_at: string | null;
  certificate_json: string | null;
};

function getLicenseRow(): LicenseRow {
  return getDb().prepare(`SELECT * FROM license WHERE id = 1`).get() as LicenseRow;
}

type Certificate = { payload: string; signature: string };

/**
 * The `status = 'activated'` column is convenient but not trusted on its own — anyone with a
 * copy of this app also has a copy of its SQLite file, and could flip that column by hand. What
 * actually grants activation is a signature over the certificate, made with a private key that
 * never leaves the seller's server; this only returns true when that signature checks out
 * against the public key embedded in license.json.
 */
function hasValidCertificate(row: LicenseRow): boolean {
  if (!row.certificate_json) return false;
  const { licensePublicKey } = getLicenseConfig();
  if (!licensePublicKey) return false;

  let cert: Certificate;
  try {
    cert = JSON.parse(row.certificate_json);
  } catch {
    return false;
  }

  try {
    const publicKey = createPublicKey({ key: licensePublicKey, format: "pem" });
    return verify(null, Buffer.from(cert.payload, "utf8"), publicKey, Buffer.from(cert.signature, "base64"));
  } catch {
    return false;
  }
}

export type LicenseStatus = {
  activated: boolean;
  trialDays: number;
  daysRemaining: number;
  expired: boolean;
};

export function getLicenseStatus(): LicenseStatus {
  if (isSellerInstance()) {
    return { activated: true, trialDays: 0, daysRemaining: Infinity, expired: false };
  }

  const row = getLicenseRow();
  const { trialDays } = getLicenseConfig();

  if (row.status === "activated" && hasValidCertificate(row)) {
    return { activated: true, trialDays, daysRemaining: Infinity, expired: false };
  }

  const startedAt = new Date(`${row.trial_started_at}Z`).getTime();
  const elapsedDays = (Date.now() - startedAt) / (24 * 60 * 60 * 1000);
  const daysRemaining = Math.max(0, Math.ceil(trialDays - elapsedDays));
  return { activated: false, trialDays, daysRemaining, expired: elapsedDays >= trialDays };
}

export function isMutationBlocked(): boolean {
  return getLicenseStatus().expired;
}

/** Where this instance's self-update check/download calls go — the same server it activated
 * against, embedded in license.json at export time. Empty for a seller's own instance/a raw repo
 * checkout, which have no such server. */
export function getLicenseServerUrl(): string {
  return getLicenseConfig().licenseServerUrl;
}

/** The license key this instance activated with — needed to authenticate an update download the
 * same way a fresh purchase would, without making the buyer re-enter anything. */
export function getActivationKey(): string | null {
  return getLicenseRow().activation_key;
}

export async function activateWithKey(key: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = key.trim();
  if (!trimmed) return { ok: false, error: "Clé requise." };

  const config = getLicenseConfig();
  if (!config.licenseServerUrl) {
    return { ok: false, error: "Aucun serveur de licence configuré dans cette version." };
  }

  let data: { valid?: boolean; error?: string; certificate?: Certificate };
  try {
    const res = await fetch(`${config.licenseServerUrl.replace(/\/$/, "")}/api/seller/license/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: trimmed }),
    });
    data = await res.json();
    if (!res.ok || !data.valid || !data.certificate) {
      return { ok: false, error: data.error || "Clé invalide ou déjà utilisée." };
    }
  } catch {
    return { ok: false, error: "Impossible de contacter le serveur de licence — vérifie la connexion Internet de cette machine." };
  }

  getDb()
    .prepare(
      `UPDATE license SET status = 'activated', activation_key = ?, activated_at = datetime('now'), certificate_json = ? WHERE id = 1`
    )
    .run(trimmed, JSON.stringify(data.certificate));
  return { ok: true };
}
