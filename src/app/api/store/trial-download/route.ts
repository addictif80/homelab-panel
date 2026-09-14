import { NextRequest, NextResponse } from "next/server";
import { buildClientArchive, readArchive } from "@/lib/seller/exportBuild";
import { getTrialDays } from "@/lib/seller/trialConfig";
import { getSigningPublicKeyPem } from "@/lib/seller/licenseSigning";
import { logAudit } from "@/lib/db";
import { resolvePublicUrl } from "@/lib/seller/publicUrl";

/** No payment, no token — anyone can grab a trial copy. Its trial clock starts the moment its
 * own database is first created (see db.ts), not at download time. */
export async function GET(req: NextRequest) {
  const { zipPath, cleanup } = await buildClientArchive({
    trialDays: getTrialDays(),
    licenseServerUrl: resolvePublicUrl(req.nextUrl.origin),
    licensePublicKey: getSigningPublicKeyPem(),
  });
  try {
    const buffer = readArchive(zipPath);
    logAudit("seller.trial_download");
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="homelab-panel-essai.zip"`,
      },
    });
  } finally {
    cleanup();
  }
}
