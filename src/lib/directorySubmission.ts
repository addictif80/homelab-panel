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
  faviconDataUrl: string | null;
};

export type DirectorySubmitResult =
  | { ok: true; submissionId: string; status: "pending" }
  | { ok: false; error: string };

export async function submitToDirectory(input: DirectorySubmitInput): Promise<DirectorySubmitResult> {
  if (isSellerInstance()) {
    return { ok: false, error: "L'annuaire public n'est pas disponible depuis l'instance du vendeur." };
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
