import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

type AuditRow = { id: number; action: string; target: string | null; detail: string | null; created_at: string };

export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 100, 500);
  const before = req.nextUrl.searchParams.get("before");
  const action = req.nextUrl.searchParams.get("action");

  const conditions: string[] = [];
  const args: (string | number)[] = [];
  if (before) {
    conditions.push("id < ?");
    args.push(Number(before));
  }
  if (action) {
    conditions.push("action LIKE ?");
    args.push(`${action}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = getDb()
    .prepare(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ?`)
    .all(...args, limit) as AuditRow[];

  return NextResponse.json({ entries: rows });
}
