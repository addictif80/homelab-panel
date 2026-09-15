import { NextRequest, NextResponse } from "next/server";
import { checkLicenseForDirectory, upsertDirectorySubmission } from "@/lib/seller/directory";
import { logAudit } from "@/lib/db";

/**
 * Public by necessity, exactly like /api/seller/license/refresh: every customer instance calls
 * this from wherever they deployed it, with no session of ours — the license key + its bound
 * instanceId is the only credential. See proxy.ts's PUBLIC_API_EXACT.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    key?: string;
    instanceId?: string;
    ownerName?: string;
    serviceName?: string;
    serviceUrl?: string;
    faviconDataUrl?: string | null;
  };

  const { key, instanceId, ownerName, serviceName, serviceUrl } = body;
  if (!key || !instanceId || !ownerName?.trim() || !serviceName?.trim() || !serviceUrl?.trim()) {
    return NextResponse.json({ error: "Champs requis manquants." }, { status: 400 });
  }
  try {
    new URL(serviceUrl);
  } catch {
    return NextResponse.json({ error: "Lien de service invalide." }, { status: 400 });
  }

  const licenseCheck = checkLicenseForDirectory(key, instanceId);
  if (!licenseCheck.ok) {
    logAudit("seller.directory_submit_denied", key, licenseCheck.error);
    return NextResponse.json({ error: licenseCheck.error }, { status: licenseCheck.status });
  }

  const submission = upsertDirectorySubmission({
    licenseKey: key,
    instanceId,
    ownerName: ownerName.trim().slice(0, 100),
    serviceName: serviceName.trim().slice(0, 100),
    serviceUrl: serviceUrl.trim(),
    faviconDataUrl: body.faviconDataUrl ?? null,
  });

  logAudit("seller.directory_submitted", submission.id, `${ownerName} — ${serviceName}`);
  return NextResponse.json({ submissionId: submission.id, status: submission.status });
}
