import { NextRequest, NextResponse } from "next/server";
import { findAnyInfraOwner } from "@/lib/firewall";

/** Used by the block-IP confirmation modal to warn before the user even confirms, rather than
 * only after a blockIp/blockIpEverywhere call has already refused it. */
export async function GET(req: NextRequest) {
  const ip = req.nextUrl.searchParams.get("ip");
  if (!ip) return NextResponse.json({ error: "Adresse IP manquante." }, { status: 400 });

  const owner = await findAnyInfraOwner(ip);
  return NextResponse.json({ owner });
}
