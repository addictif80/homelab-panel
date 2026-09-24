import { NextRequest, NextResponse } from "next/server";
import { listRecentJobs, listRunningJobs } from "@/lib/jobs";

export async function GET(req: NextRequest) {
  const running = req.nextUrl.searchParams.get("running") === "1";
  return NextResponse.json({ jobs: running ? listRunningJobs() : listRecentJobs() });
}
