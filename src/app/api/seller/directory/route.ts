import { NextResponse } from "next/server";
import { listDirectorySubmissions } from "@/lib/seller/directory";

/** Authenticated (default proxy.ts gate — not in PUBLIC_API_EXACT/PREFIXES): the seller admin's
 * review queue for /seller. */
export async function GET() {
  return NextResponse.json({ submissions: listDirectorySubmissions() });
}
