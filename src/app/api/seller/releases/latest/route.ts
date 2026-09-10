import { NextResponse } from "next/server";
import { getLatestRelease } from "@/lib/seller/releases";

/** Public — client instances have no session on the seller's server, only their license key
 * (checked at download time, not here: this is metadata only, not the code itself). */
export async function GET() {
  const release = getLatestRelease();
  return NextResponse.json({ release });
}
