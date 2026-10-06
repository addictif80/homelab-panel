import { NextResponse } from "next/server";
import { getProactiveInsight, refreshProactiveInsight } from "@/lib/assistantInsights";
import { isAiConfigured, AI_NOT_CONFIGURED_MESSAGE } from "@/lib/aiProvider";

export async function GET() {
  return NextResponse.json({ insight: getProactiveInsight(), configured: isAiConfigured() });
}

export async function POST() {
  if (!isAiConfigured()) {
    return NextResponse.json({ error: AI_NOT_CONFIGURED_MESSAGE }, { status: 400 });
  }
  await refreshProactiveInsight();
  return NextResponse.json({ insight: getProactiveInsight() });
}
