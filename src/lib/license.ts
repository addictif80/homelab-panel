import { readFileSync } from "fs";
import path from "path";
import { verify, createPublicKey, randomUUID } from "crypto";
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
  instance_id: string | null;
  last_seen_at: string | null;
};

function getLicenseRow(): LicenseRow {
  return getDb().prepare(`SELECT * FROM license WHERE id = 1`).get() as LicenseRow;
}

/**
 * A random ID generated once per install and persisted locally, embedded (signed) into every
 * certificate this instance requests. Lets getVerifiedCertificatePayload() reject a
 * certificate_json copied in from a different install's database — the copy's signature is
 * genuine, but its embedded instanceId won't match this machine's.
 */
export function getOrCreateInstanceId(): string {
  const row = getDb().prepare(`SELECT instance_id FROM license WHERE id = 1`).get() as { instance_id: string | null };
  if (row.instance_id) return row.instance_id;
  const id = randomUUID();
  getDb().prepare(`UPDATE license SET instance_id = ? WHERE id = 1`).run(id);
  return id;
}

/**
 * A monotonic floor against clock rollback: winding the system clock backwards can't "un-expire"
 * a lapsed trial or subscription, because the effective time used for every expiry check never
 * goes below the latest timestamp this instance has already observed. Advances (and persists) on
 * every call where real time has moved forward; a rolled-back clock just returns the frozen floor.
 */
function getEffectiveNowMs(row: LicenseRow): number {
  const now = Date.now();
  const lastSeenMs = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
  const effective = Math.max(now, lastSeenMs);
  if (effective > lastSeenMs) {
    getDb().prepare(`UPDATE license SET last_seen_at = ? WHERE id = 1`).run(new Date(effective).toISOString());
  }
  return effective;
}

type Certificate = { payload: string; signature: string };

type CertificatePayload = {
  key: string;
  activatedAt: string;
  /** Absent on a certificate signed before subscriptions existed — treated as "lifetime". */
  licenseType?: "lifetime" | "subscription";
  /** Subscription only: the paid-through date as of the last successful activation/refresh. */
  validUntil?: string | null;
  /** Subscription only: how many days past validUntil this instance keeps working — read fresh
   * from the seller's current setting every time the certificate is (re)signed. */
  graceDays?: number;
  /** Absent on a certificate signed before instance binding existed — treated as unbound (not
   * rejected), so pre-existing activations keep working until their next refresh re-signs with it. */
  instanceId?: string;
};

/**
 * The `status = 'activated'` column is convenient but not trusted on its own — anyone with a
 * copy of this app also has a copy of its SQLite file, and could flip that column by hand. What
 * actually grants activation is a signature over the certificate, made with a private key that
 * never leaves the seller's server; this only returns the payload once that signature checks out
 * against the public key embedded in license.json — a hand-edited certificate_json is rejected.
 */
function getVerifiedCertificatePayload(row: LicenseRow): CertificatePayload | null {
  if (!row.certificate_json) return null;
  const { licensePublicKey } = getLicenseConfig();
  if (!licensePublicKey) return null;

  let cert: Certificate;
  try {
    cert = JSON.parse(row.certificate_json);
  } catch {
    return null;
  }

  try {
    const publicKey = createPublicKey({ key: licensePublicKey, format: "pem" });
    const ok = verify(null, Buffer.from(cert.payload, "utf8"), publicKey, Buffer.from(cert.signature, "base64"));
    if (!ok) return null;
    const payload = JSON.parse(cert.payload) as CertificatePayload;

    // A genuine signature over a payload issued for a *different* key is still a well-formed
    // certificate — nothing stops it from being pasted into another install's DB row alongside a
    // locally-set matching activation_key otherwise. Both checks are cheap and independent: the
    // key match catches a certificate swapped in wholesale, the instanceId match catches one
    // copied alongside a hand-edited activation_key to match.
    if (payload.key !== row.activation_key) return null;
    if (payload.instanceId && payload.instanceId !== getOrCreateInstanceId()) return null;

    return payload;
  } catch {
    return null;
  }
}

export type LicenseStatus = {
  activated: boolean;
  /** Present only once a valid certificate has been read — tells the UI whether an `expired`
   * result means "trial ran out" (no licenseType) or "subscription lapsed" (needs a different
   * message: re-typing the same key won't help, it's already consumed). */
  licenseType?: "lifetime" | "subscription";
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
  const effectiveNowMs = getEffectiveNowMs(row);

  if (row.status === "activated") {
    const payload = getVerifiedCertificatePayload(row);
    if (payload) {
      if (payload.licenseType === "subscription" && payload.validUntil) {
        const graceMs = (payload.graceDays ?? 0) * 24 * 60 * 60 * 1000;
        const cutoffMs = new Date(payload.validUntil).getTime() + graceMs;
        const isExpired = effectiveNowMs > cutoffMs;
        return { activated: !isExpired, licenseType: "subscription", trialDays, daysRemaining: Infinity, expired: isExpired };
      }
      return { activated: true, licenseType: "lifetime", trialDays, daysRemaining: Infinity, expired: false };
    }
  }

  const startedAt = new Date(`${row.trial_started_at}Z`).getTime();
  const elapsedDays = (effectiveNowMs - startedAt) / (24 * 60 * 60 * 1000);
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
      body: JSON.stringify({ key: trimmed, instanceId: getOrCreateInstanceId() }),
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

/**
 * Called periodically (see licenseRenewalScheduler.ts) — a no-op for a seller instance, a
 * never-activated trial, or a lifetime license (nothing to refresh, it never expires). Only a
 * subscription instance actually calls home, to pick up its subscription's current paid-through
 * date. Best-effort: a network hiccup or unreachable seller server just leaves the cached
 * certificate in place — its own validUntil + graceDays already provides the fallback cutoff, so
 * a paying customer isn't punished for a transient failure to phone home.
 */
export async function refreshLicenseIfSubscription(): Promise<void> {
  if (isSellerInstance()) return;

  const row = getLicenseRow();
  if (row.status !== "activated" || !row.activation_key) return;

  const payload = getVerifiedCertificatePayload(row);
  if (!payload || payload.licenseType !== "subscription") return;

  const config = getLicenseConfig();
  if (!config.licenseServerUrl) return;

  try {
    const res = await fetch(`${config.licenseServerUrl.replace(/\/$/, "")}/api/seller/license/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: row.activation_key, instanceId: getOrCreateInstanceId() }),
    });
    const data = (await res.json()) as { valid?: boolean; certificate?: Certificate };
    if (res.ok && data.valid && data.certificate) {
      getDb().prepare(`UPDATE license SET certificate_json = ? WHERE id = 1`).run(JSON.stringify(data.certificate));
    }
  } catch {
    // See doc comment — intentionally silent.
  }
}
