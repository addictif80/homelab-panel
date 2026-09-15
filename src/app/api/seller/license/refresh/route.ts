import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/db";
import { getSaleIdForKey, getKeyInstanceBinding, bindKeyInstanceId } from "@/lib/seller/licenseKeys";
import { buildCertificateForSale } from "@/lib/seller/licenseCertificate";

/**
 * Re-issues a fresh, freshly-signed certificate for an *already activated* key — unlike /validate
 * (first-use-wins, single activation), this never consumes anything and can be called repeatedly.
 * A subscription instance calls this periodically to pick up its subscription's current
 * paid-through date; a lifetime instance never needs to (its certificate never expires), but
 * calling it is harmless. The key must have been activated at least once already — this isn't a
 * second way to activate a never-used key.
 *
 * This endpoint is public (no session) by necessity, so the key text alone can't be the only
 * credential: /validate binds the activating instance's instanceId to the key, and this route
 * requires a matching instanceId before it will hand out a certificate. Without that check, anyone
 * who merely learned another customer's license key (printed in an email, a config file, a
 * support ticket) could call this endpoint directly and mint a validly-signed certificate for
 * their own, unrelated installation. A key activated before this binding existed adopts whichever
 * instanceId first calls refresh for it, so existing customers aren't locked out.
 *
 * Also the actual enforcement point for self-service revocation (see /api/seller/license/revoke):
 * a revoked key is rejected here with `revoked: true` instead of the generic error shape, which
 * license.ts's periodic refreshLicenseCertificate() checks for specifically — it's what makes
 * revocation eventually take effect against a cloned/leaked copy of an install that would
 * otherwise never call home again once activated (this is why that periodic refresh now also
 * runs for lifetime licenses, not just subscriptions).
 */
export async function POST(req: NextRequest) {
  const { key, instanceId } = (await req.json()) as { key?: string; instanceId?: string };
  if (!key) return NextResponse.json({ valid: false, error: "Clé requise." }, { status: 400 });

  const binding = getKeyInstanceBinding(key);
  if (!binding) return NextResponse.json({ valid: false, error: "Clé inconnue." }, { status: 400 });
  if (binding.revokedAt) {
    logAudit("seller.license_refresh_denied", key, "revoked");
    return NextResponse.json({ valid: false, revoked: true, error: "Cette clé a été révoquée." }, { status: 403 });
  }
  if (!binding.usedAt) {
    return NextResponse.json({ valid: false, error: "Cette clé n'a jamais été activée." }, { status: 400 });
  }

  let boundInstanceId = binding.instanceId;
  if (boundInstanceId) {
    if (!instanceId || instanceId !== boundInstanceId) {
      logAudit("seller.license_refresh_denied", key, "instance mismatch");
      return NextResponse.json({ valid: false, error: "Cette clé est liée à une autre installation." }, { status: 403 });
    }
  } else if (instanceId) {
    bindKeyInstanceId(key, instanceId);
    boundInstanceId = instanceId;
  }

  const certificate = buildCertificateForSale(key, getSaleIdForKey(key), boundInstanceId);
  logAudit("seller.license_refresh", key);
  return NextResponse.json({ valid: true, certificate });
}
