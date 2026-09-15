import { NextResponse } from "next/server";
import { getLicenseStatus } from "@/lib/license";

export async function GET() {
  const status = getLicenseStatus();
  return NextResponse.json({
    activated: status.activated,
    isSellerInstance: !!status.isSellerInstance,
    licenseType: status.licenseType,
    trialDays: status.trialDays,
    daysRemaining: Number.isFinite(status.daysRemaining) ? status.daysRemaining : null,
    expired: status.expired,
    activationKey: status.activationKey ?? null,
    activatedAt: status.activatedAt ?? null,
    validUntil: status.validUntil ?? null,
  });
}
