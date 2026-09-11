import { NextResponse } from "next/server";
import { getFleetPulse } from "@/lib/pulse";

export async function GET() {
  const pulses = await getFleetPulse();
  return NextResponse.json({ pulses });
}
