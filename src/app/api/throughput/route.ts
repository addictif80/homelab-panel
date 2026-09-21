import { NextResponse } from "next/server";
import { getCurrentRunId, getLatestRunId, getPairCount, getRunResults, runFleetThroughputMatrix } from "@/lib/throughput";
import { logAudit } from "@/lib/db";

export async function GET() {
  const runningId = getCurrentRunId();
  const runId = runningId || getLatestRunId();
  return NextResponse.json({
    running: !!runningId,
    runId,
    pairCount: getPairCount(),
    results: runId ? getRunResults(runId) : [],
  });
}

export async function POST() {
  try {
    const runId = await runFleetThroughputMatrix();
    logAudit("throughput.run", undefined, "Test de débit réel lancé entre toutes les machines.");
    return NextResponse.json({ runId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 400 });
  }
}
