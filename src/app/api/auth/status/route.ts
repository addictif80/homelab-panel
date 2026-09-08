import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const { c } = getDb().prepare(`SELECT COUNT(*) as c FROM users`).get() as { c: number };
  return NextResponse.json({ setupRequired: c === 0 });
}
