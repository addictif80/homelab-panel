import { NextResponse } from "next/server";
import { getHardwareHealth } from "@/lib/hardwareHealth";
import { withTimeout } from "@/lib/timeout";

const HEALTH_TIMEOUT_MS = 20_000;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hostId = Number(id);

  try {
    const health = await withTimeout(getHardwareHealth(hostId), HEALTH_TIMEOUT_MS, "Délai dépassé lors de la lecture des capteurs.");
    return NextResponse.json({ health });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
