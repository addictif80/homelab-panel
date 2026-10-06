import { NextRequest, NextResponse } from "next/server";
import { isAiConfigured, streamAiChat, AI_NOT_CONFIGURED_MESSAGE, type ChatMessage } from "@/lib/aiProvider";

// Opts this route out of Next.js's route-level fetch caching/memoization — the upstream call
// must run fresh, streamed straight through, every single time, never served from a cache entry.
export const dynamic = "force-dynamic";

/**
 * Streams straight through from the configured AI provider (Ollama or 1min.ai — see
 * lib/aiProvider.ts), always as newline-delimited JSON (one `{message:{content},done}` object per
 * line, Ollama's own /api/chat shape) regardless of which provider is actually configured — keeps
 * the assistant page and the resolution guide unchanged no matter which one is active.
 */
export async function POST(req: NextRequest) {
  if (!isAiConfigured()) {
    return NextResponse.json({ error: AI_NOT_CONFIGURED_MESSAGE }, { status: 400 });
  }

  const { messages, context } = (await req.json()) as { messages: ChatMessage[]; context?: string };
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "Aucun message." }, { status: 400 });
  }

  const result = await streamAiChat(messages, context);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return result.response;
}
