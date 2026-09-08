import { NextResponse } from "next/server";
import { listDevices } from "@/lib/tailscale";

export async function GET() {
  try {
    const devices = await listDevices();
    return NextResponse.json({ devices });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur Tailscale." },
      { status: 502 }
    );
  }
}
