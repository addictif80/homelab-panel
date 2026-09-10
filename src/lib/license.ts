import { readFileSync } from "fs";
import path from "path";
import { getDb } from "./db";

type LicenseConfig = { trialDays: number; licenseServerUrl: string };

let cachedConfig: LicenseConfig | null = null;

/**
 * Read once per process from license.json at the project root. The seller's export builder
 * overwrites this file's contents in every zip it produces (trial length + where to validate a
 * key) — the version checked into the seller's own repo is just a harmless default.
 */
type RawLicenseFile = LicenseConfig & { preActivatedKey?: string };

function readLicenseFile(): RawLicenseFile {
  try {
    const raw = readFileSync(path.join(process.cwd(), "license.json"), "utf8");
    const parsed = JSON.parse(raw);
    return {
      trialDays: Number(parsed.trialDays) || 14,
      licenseServerUrl: typeof parsed.licenseServerUrl === "string" ? parsed.licenseServerUrl : "",
      preActivatedKey: typeof parsed.preActivatedKey === "string" ? parsed.preActivatedKey : undefined,
    };
  } catch {
    return { trialDays: 14, licenseServerUrl: "" };
  }
}

function getLicenseConfig(): LicenseConfig {
  if (!cachedConfig) {
    const { trialDays, licenseServerUrl } = readLicenseFile();
    cachedConfig = { trialDays, licenseServerUrl };
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

/** The seller's own deployment is never trial-limited — this flag only exists there. */
export function isSellerInstance(): boolean {
  return process.env.NEXT_PUBLIC_SELLER_MODE === "true";
}

type LicenseRow = {
  status: "trial" | "activated";
  trial_started_at: string;
  activation_key: string | null;
  activated_at: string | null;
};

function getLicenseRow(): LicenseRow {
  return getDb().prepare(`SELECT * FROM license WHERE id = 1`).get() as LicenseRow;
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

  if (row.status === "activated") {
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

export async function activateWithKey(key: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = key.trim();
  if (!trimmed) return { ok: false, error: "Clé requise." };

  const config = getLicenseConfig();
  if (!config.licenseServerUrl) {
    return { ok: false, error: "Aucun serveur de licence configuré dans cette version." };
  }

  let data: { valid?: boolean; error?: string };
  try {
    const res = await fetch(`${config.licenseServerUrl.replace(/\/$/, "")}/api/seller/license/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: trimmed }),
    });
    data = await res.json();
    if (!res.ok || !data.valid) {
      return { ok: false, error: data.error || "Clé invalide ou déjà utilisée." };
    }
  } catch {
    return { ok: false, error: "Impossible de contacter le serveur de licence — vérifie la connexion Internet de cette machine." };
  }

  getDb()
    .prepare(`UPDATE license SET status = 'activated', activation_key = ?, activated_at = datetime('now') WHERE id = 1`)
    .run(trimmed);
  return { ok: true };
}
