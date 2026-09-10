import { NextRequest, NextResponse } from "next/server";
import { buildClientArchive, readArchive } from "@/lib/seller/exportBuild";
import { getTrialDays } from "@/lib/seller/trialConfig";
import { getSigningPublicKeyPem } from "@/lib/seller/licenseSigning";

/** Lets the owner download the exact archive a buyer would get, without going through Stripe —
 * for verifying the export before actually selling anything. Ships as a trial copy (no key),
 * same as the free trial download. */
export async function GET(req: NextRequest) {
  const { zipPath, cleanup } = await buildClientArchive({
    trialDays: getTrialDays(),
    licenseServerUrl: req.nextUrl.origin,
    licensePublicKey: getSigningPublicKeyPem(),
  });
  try {
    const buffer = readArchive(zipPath);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="homelab-panel-test-export.zip"`,
      },
    });
  } finally {
    cleanup();
  }
}
