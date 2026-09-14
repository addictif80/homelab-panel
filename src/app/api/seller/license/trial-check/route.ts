import { NextRequest, NextResponse } from "next/server";
import { registerTrialFingerprint } from "@/lib/seller/trialFingerprints";
import { logAudit } from "@/lib/db";

/**
 * Public by necessity, like /validate and /refresh: every buyer's self-hosted trial instance
 * calls this from wherever they deployed it, with no session of ours. Anti-reset measure — see
 * lib/machineFingerprint.ts and lib/seller/trialFingerprints.ts for why this can't simply be
 * bypassed by wiping the client's local database.
 */
export async function POST(req: NextRequest) {
  const { fingerprint } = (await req.json().catch(() => ({}))) as { fingerprint?: string };
  if (!fingerprint || typeof fingerprint !== "string" || fingerprint.length < 32) {
    return NextResponse.json({ error: "Empreinte invalide." }, { status: 400 });
  }

  const firstSeenAt = registerTrialFingerprint(fingerprint);
  logAudit("seller.trial_check", fingerprint.slice(0, 12));
  return NextResponse.json({ firstSeenAt: `${firstSeenAt}Z` });
}
