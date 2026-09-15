import { NextResponse } from "next/server";
import { listLicenseKeysWithOrigin } from "@/lib/seller/licenseKeys";

export async function GET() {
  const keys = listLicenseKeysWithOrigin();
  return NextResponse.json({
    keys,
    totalIssued: keys.length,
    totalUsed: keys.filter((k) => k.usedAt).length,
  });
}
