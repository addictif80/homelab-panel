import { NextRequest, NextResponse } from "next/server";
import { getDeviceRoutes, setDeviceRoutes } from "@/lib/tailscale";
import { logAudit } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  try {
    const routes = await getDeviceRoutes(deviceId);
    return NextResponse.json(routes);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  const { enabledRoutes } = (await req.json()) as { enabledRoutes?: string[] };
  try {
    await setDeviceRoutes(deviceId, enabledRoutes || []);
    logAudit("tailscale.routes_updated", deviceId, JSON.stringify(enabledRoutes));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
