import { NextResponse } from "next/server";
import { listBlockedIps } from "@/lib/firewall";

export async function GET() {
  return NextResponse.json({ blockedIps: listBlockedIps() });
}
