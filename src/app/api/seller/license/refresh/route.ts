import { NextRequest, NextResponse } from "next/server";
import { getDb, logAudit } from "@/lib/db";
import { getSaleIdForKey } from "@/lib/seller/licenseKeys";
import { buildCertificateForSale } from "@/lib/seller/licenseCertificate";

/**
 * Re-issues a fresh, freshly-signed certificate for an *already activated* key — unlike /validate
 * (first-use-wins, single activation), this never consumes anything and can be called repeatedly.
 * A subscription instance calls this periodically to pick up its subscription's current
 * paid-through date; a lifetime instance never needs to (its certificate never expires), but
 * calling it is harmless. The key must have been activated at least once already — this isn't a
 * second way to activate a never-used key.
 */
export async function POST(req: NextRequest) {
  const { key } = (await req.json()) as { key?: string };
  if (!key) return NextResponse.json({ valid: false, error: "Clé requise." }, { status: 400 });

  const row = getDb().prepare(`SELECT used_at FROM license_keys WHERE key = ?`).get(key) as
    | { used_at: string | null }
    | undefined;
  if (!row) return NextResponse.json({ valid: false, error: "Clé inconnue." }, { status: 400 });
  if (!row.used_at) return NextResponse.json({ valid: false, error: "Cette clé n'a jamais été activée." }, { status: 400 });

  const certificate = buildCertificateForSale(key, getSaleIdForKey(key));
  logAudit("seller.license_refresh", key);
  return NextResponse.json({ valid: true, certificate });
}
