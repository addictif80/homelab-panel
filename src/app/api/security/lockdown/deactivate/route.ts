import { NextResponse } from "next/server";
import { deactivateLockdown } from "@/lib/lockdown";

export async function POST() {
  await deactivateLockdown();
  return NextResponse.json({ ok: true });
}
