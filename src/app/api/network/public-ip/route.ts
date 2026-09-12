import { NextResponse } from "next/server";
import { getPanelPublicIp } from "@/lib/publicIp";

export async function GET() {
  const ip = await getPanelPublicIp();
  return NextResponse.json({ ip });
}
