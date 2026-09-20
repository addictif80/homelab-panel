import { NextResponse } from "next/server";
import { checkAllDomains } from "@/lib/certWatch";

export async function GET() {
  const statuses = await checkAllDomains();
  return NextResponse.json({ statuses });
}
