import { NextRequest, NextResponse } from "next/server";
import { setDeviceAuthorized } from "@/lib/tailscale";
import { logAudit } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  const { authorized } = await req.json();
  try {
    await setDeviceAuthorized(deviceId, !!authorized);
    logAudit("tailscale.device_authorize", deviceId, String(!!authorized));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur Tailscale." },
      { status: 502 }
    );
  }
}
