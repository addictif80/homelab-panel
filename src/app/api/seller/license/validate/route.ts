import { NextRequest, NextResponse } from "next/server";
import { validateAndConsumeKey, getSaleIdForKey } from "@/lib/seller/licenseKeys";
import { buildCertificateForSale } from "@/lib/seller/licenseCertificate";
import { logAudit } from "@/lib/db";

/**
 * Public by necessity: every buyer's self-hosted instance calls this from wherever they deployed
 * it, with no session of ours to authenticate — the key itself, checked against license_keys
 * (first-use-wins), is the only credential here.
 */
export async function POST(req: NextRequest) {
  const { key, instanceInfo, instanceId } = (await req.json()) as {
    key?: string;
    instanceInfo?: string;
    instanceId?: string;
  };
  if (!key) return NextResponse.json({ valid: false, error: "Clé requise." }, { status: 400 });

  const result = validateAndConsumeKey(key, instanceInfo, instanceId);
  logAudit("seller.license_validate", key, result.valid ? "ok" : result.error);

  if (!result.valid) {
    return NextResponse.json({ valid: false, error: result.error }, { status: 400 });
  }

  const certificate = buildCertificateForSale(key, getSaleIdForKey(key), instanceId);
  return NextResponse.json({ valid: true, certificate });
}
