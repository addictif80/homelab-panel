import { NextResponse } from "next/server";
import { getRiskScoreHistory, refreshRiskScoreHistory } from "@/lib/security/riskScore";

export async function GET() {
  const history = getRiskScoreHistory(30);
  return NextResponse.json({ history, current: history.at(-1)?.score ?? null });
}

/** "Recalculer" — runs a fresh full scan right now instead of waiting for tomorrow's scheduled
 * pass, same underlying computation either way. */
export async function POST() {
  const breakdown = await refreshRiskScoreHistory();
  return NextResponse.json(breakdown);
}
