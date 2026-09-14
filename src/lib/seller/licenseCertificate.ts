import { getSale } from "./sales";
import { getSubscriptionGraceDays } from "./subscriptionConfig";
import { signLicensePayload, type LicenseCertificate } from "./licenseSigning";

/**
 * Builds and signs the certificate a client stores after activating (or refreshing) a key.
 * `graceDays` is read fresh from the seller's current setting every time this signs a new
 * certificate — rather than baking it into the static license.json at export time — so changing
 * the grace period applies to every instance out there on its next refresh, not just future
 * downloads. Lifetime sales (or a key with no sale on record, e.g. free trial edge cases) get a
 * certificate with no expiry at all, exactly like before subscriptions existed.
 */
export function buildCertificateForSale(key: string, saleId: string | null): LicenseCertificate {
  const sale = saleId ? getSale(saleId) : null;
  const payload: Record<string, unknown> = { key, activatedAt: new Date().toISOString() };

  if (sale && sale.productType !== "lifetime") {
    payload.licenseType = "subscription";
    payload.validUntil = sale.currentPeriodEnd;
    payload.graceDays = getSubscriptionGraceDays();
  } else {
    payload.licenseType = "lifetime";
  }

  return signLicensePayload(payload);
}
