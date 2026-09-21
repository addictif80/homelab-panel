import { NextResponse } from "next/server";
import { getProactiveInsight, refreshProactiveInsight } from "@/lib/assistantInsights";
import { isOllamaConfigured } from "@/lib/ollama";

export async function GET() {
  return NextResponse.json({ insight: getProactiveInsight(), configured: isOllamaConfigured() });
}

export async function POST() {
  if (!isOllamaConfigured()) {
    return NextResponse.json({ error: "L'assistant IA n'est pas configuré (Réglages > Assistant IA (Ollama))." }, { status: 400 });
  }
  await refreshProactiveInsight();
  return NextResponse.json({ insight: getProactiveInsight() });
}
