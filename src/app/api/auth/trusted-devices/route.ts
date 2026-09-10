import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { listTrustedDevices, revokeAllTrustedDevices } from "@/lib/trustedDevices";
import { logAudit } from "@/lib/db";

async function currentUsername(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  return token ? await verifySessionToken(token) : null;
}

export async function GET(req: NextRequest) {
  const username = await currentUsername(req);
  if (!username) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  return NextResponse.json({ devices: listTrustedDevices(username) });
}

export async function DELETE(req: NextRequest) {
  const username = await currentUsername(req);
  if (!username) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  revokeAllTrustedDevices(username);
  logAudit("trusted_device.revoke_all", username);
  return NextResponse.json({ ok: true });
}
