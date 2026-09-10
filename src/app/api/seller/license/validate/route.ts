import { NextRequest, NextResponse } from "next/server";
import { validateAndConsumeKey } from "@/lib/seller/licenseKeys";
import { logAudit } from "@/lib/db";

/**
 * Public by necessity: every buyer's self-hosted instance calls this from wherever they deployed
 * it, with no session of ours to authenticate — the key itself, checked against license_keys
 * (first-use-wins), is the only credential here.
 */
export async function POST(req: NextRequest) {
  const { key, instanceInfo } = (await req.json()) as { key?: string; instanceInfo?: string };
  if (!key) return NextResponse.json({ valid: false, error: "Clé requise." }, { status: 400 });

  const result = validateAndConsumeKey(key, instanceInfo);
  logAudit("seller.license_validate", key, result.valid ? "ok" : result.error);

  if (!result.valid) {
    return NextResponse.json({ valid: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ valid: true });
}
