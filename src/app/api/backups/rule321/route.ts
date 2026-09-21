import { NextResponse } from "next/server";
import { checkRule321 } from "@/lib/backup/rule321";

export async function GET() {
  return NextResponse.json({ statuses: checkRule321() });
}
