import { NextRequest, NextResponse } from "next/server";
import { listReleases, publishRelease } from "@/lib/seller/releases";
import { logAudit } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ releases: listReleases() });
}

export async function POST(req: NextRequest) {
  const { version, changelog } = (await req.json()) as { version?: string; changelog?: string };
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    return NextResponse.json({ error: "Version invalide (format attendu : 1.2.3)." }, { status: 400 });
  }
  const release = publishRelease(version, changelog || "");
  logAudit("seller.release_publish", version);
  return NextResponse.json({ release });
}
