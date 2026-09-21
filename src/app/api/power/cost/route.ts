import { NextRequest, NextResponse } from "next/server";
import { getPowerCostSummary, setElectricityPrice } from "@/lib/power/cost";

export async function GET(req: NextRequest) {
  const days = Math.min(Number(req.nextUrl.searchParams.get("days")) || 30, 35);
  return NextResponse.json(getPowerCostSummary(days));
}

export async function PUT(req: NextRequest) {
  const { pricePerKwh } = (await req.json().catch(() => ({}))) as { pricePerKwh?: number };
  if (typeof pricePerKwh !== "number" || !Number.isFinite(pricePerKwh) || pricePerKwh <= 0) {
    return NextResponse.json({ error: "Prix invalide." }, { status: 400 });
  }
  setElectricityPrice(pricePerKwh);
  return NextResponse.json({ ok: true });
}
