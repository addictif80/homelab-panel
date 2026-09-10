import { NextRequest, NextResponse } from "next/server";
import { isKnownLicenseKey } from "@/lib/seller/releases";
import { buildClientArchive, readArchive } from "@/lib/seller/exportBuild";
import { getTrialDays } from "@/lib/seller/trialConfig";
import { getSigningPublicKeyPem } from "@/lib/seller/licenseSigning";
import { logAudit } from "@/lib/db";

/** Public — but gated by a real license key (any key ever issued, not necessarily unused) so
 * only instances that actually bought the panel can pull an update archive from here. */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") || "";
  if (!key || !isKnownLicenseKey(key)) {
    return NextResponse.json({ error: "Clé de licence invalide." }, { status: 403 });
  }

  const { zipPath, cleanup } = await buildClientArchive({
    trialDays: getTrialDays(),
    licenseServerUrl: req.nextUrl.origin,
    licensePublicKey: getSigningPublicKeyPem(),
  });
  try {
    const buffer = readArchive(zipPath);
    logAudit("seller.update_downloaded", key);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="homelab-panel-update.zip"`,
      },
    });
  } finally {
    cleanup();
  }
}
