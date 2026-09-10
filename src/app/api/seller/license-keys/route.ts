import { NextResponse } from "next/server";
import { listLicenseKeys } from "@/lib/seller/licenseKeys";

export async function GET() {
  const keys = listLicenseKeys();
  return NextResponse.json({
    keys,
    totalIssued: keys.length,
    totalUsed: keys.filter((k) => k.usedAt).length,
  });
}
