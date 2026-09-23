import { NextRequest, NextResponse } from "next/server";
import { cancelEmergencyAccess } from "@/lib/emergencyAccess";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Jeton manquant." }, { status: 400 });
  }
  const ok = cancelEmergencyAccess(token);
  if (!ok) {
    return NextResponse.json({ error: "Jeton invalide ou demande déjà traitée." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
