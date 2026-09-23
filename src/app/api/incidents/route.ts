import { NextRequest, NextResponse } from "next/server";
import { detectRecentIncidents, generateIncidentStory } from "@/lib/incidentStory";

export async function GET(req: NextRequest) {
  const days = Number(req.nextUrl.searchParams.get("days")) || 30;
  const incidents = detectRecentIncidents(days).map((incident) => ({
    ...incident,
    story: generateIncidentStory(incident),
  }));
  return NextResponse.json({ incidents });
}
