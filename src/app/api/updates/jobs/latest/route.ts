import { NextRequest, NextResponse } from "next/server";
import { getLatestUpdateJob } from "@/lib/updates";

export async function GET(req: NextRequest) {
  const hostId = Number(req.nextUrl.searchParams.get("hostId"));
  if (!hostId) return NextResponse.json({ error: "hostId requis." }, { status: 400 });
  const job = getLatestUpdateJob(hostId);
  return NextResponse.json({ job });
}
