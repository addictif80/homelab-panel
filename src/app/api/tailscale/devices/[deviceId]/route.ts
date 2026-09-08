import { NextRequest, NextResponse } from "next/server";
import { removeDevice } from "@/lib/tailscale";
import { logAudit } from "@/lib/db";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  try {
    await removeDevice(deviceId);
    logAudit("tailscale.device_removed", deviceId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur Tailscale." },
      { status: 502 }
    );
  }
}
