import { getSetting, setSetting } from "./db";
import { getLicenseServerUrl, getActivationKey, getOrCreateInstanceId, isSellerInstance } from "./license";

/**
 * Client-side half of the public directory feature — ships in every customer install (unlike
 * src/lib/seller/directory.ts, which holds the submission storage + moderation and is stripped
 * from the client build, see exportBuild.ts). Talks to the seller's own instance the exact same
 * way license.ts's activate/refresh calls do: the license key + this instance's id are the only
 * credential, since there is no session to authenticate with on a public endpoint.
 */

const OWNER_NAME_SETTING_KEY = "directory_owner_name";

export function getDirectoryOwnerName(): string {
  return getSetting(OWNER_NAME_SETTING_KEY) || "";
}

export function setDirectoryOwnerName(name: string): void {
  setSetting(OWNER_NAME_SETTING_KEY, name.trim());
}

export type DirectorySubmitInput = {
  ownerName: string;
  serviceName: string;
  serviceUrl: string;
  description: string;
  faviconDataUrl: string | null;
  screenshotDataUrl: string | null;
};

export type DirectorySubmitResult =
  | { ok: true; submissionId: string; status: "pending" }
  | { ok: false; error: string };

// Fixed (license_key, instance_id) pair for the seller's own submissions — there's no real
// license key to check against on the seller's own instance, and submissions land directly in
// the local directory_submissions table instead of over HTTP (there's no "remote seller server"
// to call, this instance *is* that server). Only ever reached when isSellerInstance() is true,
// which is hardcoded to false in every customer export (see exportBuild.ts) — the dynamic
// require() below (rather than a static import) is what keeps this file buildable for a customer,
// whose copy never has src/lib/seller/ at all. The hand-written type (rather than
// `typeof import("./seller/directory")`) matters too: a type-only reference to that path still
// makes tsc try to resolve the module for its shape, which fails the same way a real import would
// on a customer's copy even though the code itself never runs there.
const SELLER_SUBMISSION_IDENTITY = { licenseKey: "__seller__", instanceId: "__seller__" };

type SellerDirectoryModule = {
  upsertDirectorySubmission: (input: DirectorySubmitInput & { licenseKey: string; instanceId: string }) => { id: string };
  withdrawDirectorySubmission: (id: string, licenseKey: string, instanceId: string) => boolean;
};

export async function submitToDirectory(input: DirectorySubmitInput): Promise<DirectorySubmitResult> {
  if (isSellerInstance()) {
    const { upsertDirectorySubmission } = require("./seller/directory") as SellerDirectoryModule;
    const submission = upsertDirectorySubmission({ ...SELLER_SUBMISSION_IDENTITY, ...input });
    return { ok: true, submissionId: submission.id, status: "pending" };
  }
  const serverUrl = getLicenseServerUrl();
  const key = getActivationKey();
  if (!serverUrl || !key) {
    return { ok: false, error: "Active ta licence pour pouvoir soumettre un service à l'annuaire public." };
  }

  try {
    const res = await fetch(`${serverUrl.replace(/\/$/, "")}/api/seller/directory/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, instanceId: getOrCreateInstanceId(), ...input }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.submissionId) {
      return { ok: false, error: data.error || "Échec de la soumission à l'annuaire." };
    }
    return { ok: true, submissionId: data.submissionId, status: "pending" };
  } catch {
    return { ok: false, error: "Impossible de contacter le serveur de licence — vérifie la connexion Internet." };
  }
}

/** Best-effort: even if the seller's server can't be reached, the caller still clears the local
 * opt-in state — the customer withdrawing shouldn't be blocked by a transient network issue. */
export async function withdrawFromDirectory(submissionId: string): Promise<void> {
  if (isSellerInstance()) {
    const { withdrawDirectorySubmission } = require("./seller/directory") as SellerDirectoryModule;
    withdrawDirectorySubmission(submissionId, SELLER_SUBMISSION_IDENTITY.licenseKey, SELLER_SUBMISSION_IDENTITY.instanceId);
    return;
  }
  const serverUrl = getLicenseServerUrl();
  const key = getActivationKey();
  if (!serverUrl || !key) return;
  try {
    await fetch(`${serverUrl.replace(/\/$/, "")}/api/seller/directory/withdraw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, instanceId: getOrCreateInstanceId(), submissionId }),
    });
  } catch {
    // best-effort
  }
}
