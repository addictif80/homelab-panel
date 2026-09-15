import { NextRequest, NextResponse } from "next/server";
import { getScheduleSettings, setScheduleSettings } from "@/lib/notifications/scheduleSettings";

export async function GET() {
  return NextResponse.json(getScheduleSettings());
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const checkIntervalMinutes = Number(body.checkIntervalMinutes);
  const renotifyAfterHours = Number(body.renotifyAfterHours);
  const minSendGapMinutes = Number(body.minSendGapMinutes);
  if (![checkIntervalMinutes, renotifyAfterHours, minSendGapMinutes].every((n) => Number.isFinite(n) && n > 0)) {
    return NextResponse.json({ error: "Valeurs invalides." }, { status: 400 });
  }
  if (minSendGapMinutes > checkIntervalMinutes) {
    return NextResponse.json(
      { error: "L'écart minimal entre deux envois doit être inférieur ou égal à l'intervalle de vérification." },
      { status: 400 }
    );
  }
  setScheduleSettings({ checkIntervalMinutes, renotifyAfterHours, minSendGapMinutes });
  return NextResponse.json({ ok: true });
}
