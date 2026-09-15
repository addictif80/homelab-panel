import { NextRequest, NextResponse } from "next/server";
import { checkLicenseForDirectory, withdrawDirectorySubmission } from "@/lib/seller/directory";
import { logAudit } from "@/lib/db";

/** Public by necessity, like /submit — ownership of the row (matching license_key + instanceId)
 * is checked in withdrawDirectorySubmission() itself, not just the license binding here. */
export async function POST(req: NextRequest) {
  const { key, instanceId, submissionId } = (await req.json().catch(() => ({}))) as {
    key?: string;
    instanceId?: string;
    submissionId?: string;
  };
  if (!key || !instanceId || !submissionId) {
    return NextResponse.json({ error: "Champs requis manquants." }, { status: 400 });
  }

  const licenseCheck = checkLicenseForDirectory(key, instanceId);
  if (!licenseCheck.ok) return NextResponse.json({ error: licenseCheck.error }, { status: licenseCheck.status });

  const removed = withdrawDirectorySubmission(submissionId, key, instanceId);
  logAudit("seller.directory_withdrawn", submissionId, removed ? "ok" : "not found / not owner");
  return NextResponse.json({ ok: true, removed });
}
