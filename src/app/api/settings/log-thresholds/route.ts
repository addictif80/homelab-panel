import { NextRequest, NextResponse } from "next/server";
import { getDetectionThresholds, setDetectionThresholds } from "@/lib/logAnalysisSettings";

export async function GET() {
  return NextResponse.json(getDetectionThresholds());
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const authFailure = Number(body.authFailure);
  const notFound = Number(body.notFound);
  const highVolume = Number(body.highVolume);
  if (![authFailure, notFound, highVolume].every((n) => Number.isFinite(n) && n > 0)) {
    return NextResponse.json({ error: "Seuils invalides." }, { status: 400 });
  }
  setDetectionThresholds({ authFailure, notFound, highVolume });
  return NextResponse.json({ ok: true });
}
