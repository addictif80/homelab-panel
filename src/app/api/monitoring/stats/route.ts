import { NextResponse } from "next/server";
import { getFleetStats } from "@/lib/monitoring";

export async function GET() {
  const hosts = await getFleetStats();
  return NextResponse.json({ hosts });
}
