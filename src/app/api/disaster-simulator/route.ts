import { NextRequest, NextResponse } from "next/server";
import { simulateDisaster } from "@/lib/disasterSimulator";

export async function GET(req: NextRequest) {
  const hostId = Number(req.nextUrl.searchParams.get("hostId"));
  if (!hostId) return NextResponse.json({ error: "Machine requise." }, { status: 400 });
  try {
    return NextResponse.json({ steps: simulateDisaster(hostId) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 400 });
  }
}
