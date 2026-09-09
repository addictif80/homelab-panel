import { NextResponse } from "next/server";
import { scanAllHosts } from "@/lib/security/scan";

export async function GET() {
  const results = await scanAllHosts();
  return NextResponse.json({ results });
}
