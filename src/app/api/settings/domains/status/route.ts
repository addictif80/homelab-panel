import { NextResponse } from "next/server";
import { checkAllRegDomains } from "@/lib/domainInfo";

export async function GET() {
  const statuses = await checkAllRegDomains();
  return NextResponse.json({ statuses });
}
