import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { revokeTrustedDevice } from "@/lib/trustedDevices";
import { logAudit } from "@/lib/db";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const username = token ? await verifySessionToken(token) : null;
  if (!username) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { id } = await params;
  revokeTrustedDevice(username, id);
  logAudit("trusted_device.revoke", username, id);
  return NextResponse.json({ ok: true });
}
