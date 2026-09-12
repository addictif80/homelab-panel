import { NextRequest, NextResponse } from "next/server";
import { getPulseHistory } from "@/lib/pulse";

const MAX_HOURS = 24;

export async function GET(req: NextRequest) {
  const requested = Number(req.nextUrl.searchParams.get("hours") ?? "1");
  const hours = Number.isFinite(requested) ? Math.min(Math.max(requested, 0.1), MAX_HOURS) : 1;

  const rows = getPulseHistory(hours);

  // Group into ticks by exact timestamp — one recording pass writes every host within the same
  // second, so this reconstructs the original snapshots without needing a separate "tick id".
  const byTick = new Map<string, { hostId: number; reachable: boolean; latencyMs: number | null }[]>();
  for (const row of rows) {
    const entry = byTick.get(row.recordedAt) ?? [];
    entry.push({ hostId: row.hostId, reachable: row.reachable, latencyMs: row.latencyMs });
    byTick.set(row.recordedAt, entry);
  }
  const ticks = Array.from(byTick.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([recordedAt, pulses]) => ({ recordedAt, pulses }));

  return NextResponse.json({ ticks });
}
