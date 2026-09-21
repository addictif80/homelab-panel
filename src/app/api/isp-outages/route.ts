import { NextResponse } from "next/server";
import { getOutageSummary } from "@/lib/isp/report";

export async function GET() {
  return NextResponse.json(getOutageSummary());
}
