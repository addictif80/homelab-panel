import { NextResponse } from "next/server";
import { isLockdownActive, getLockdownActivatedAt } from "@/lib/lockdown";

export async function GET() {
  return NextResponse.json({ active: isLockdownActive(), activatedAt: getLockdownActivatedAt() });
}
