import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/db";
import { revokeAndReissueKey, getSaleIdForKey } from "@/lib/seller/licenseKeys";
import { buildCertificateForSale } from "@/lib/seller/licenseCertificate";

/**
 * Public (no session) by necessity, like /validate and /refresh — the caller's own instance is the
 * one requesting this, with no session of ours. Ownership is proven the same way: the key must
 * already be activated and bound to this exact instanceId (checked inside revokeAndReissueKey).
 * A stolen key alone can't trigger this against someone else's installation.
 */
export async function POST(req: NextRequest) {
  const { key, instanceId } = (await req.json().catch(() => ({}))) as { key?: string; instanceId?: string };
  if (!key || !instanceId) {
    return NextResponse.json({ valid: false, error: "Clé et identifiant d'instance requis." }, { status: 400 });
  }

  const result = revokeAndReissueKey(key, instanceId);
  if (!result.ok) {
    logAudit("seller.license_revoke_denied", key, result.error);
    return NextResponse.json({ valid: false, error: result.error }, { status: 400 });
  }

  const certificate = buildCertificateForSale(result.newKey, getSaleIdForKey(result.newKey), instanceId);
  logAudit("seller.license_revoked", key, `remplacée par ${result.newKey}`);
  return NextResponse.json({ valid: true, newKey: result.newKey, certificate });
}
