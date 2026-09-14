import { NextRequest, NextResponse } from "next/server";
import { getOllamaConfig, buildSystemPrompt, type ChatMessage } from "@/lib/ollama";

/**
 * Streams straight through from Ollama's own /api/chat (newline-delimited JSON, one
 * `{message:{content},done}` object per line) instead of buffering a full answer server-side —
 * keeps the assistant page and the resolution guide responsive on slower local models.
 */
export async function POST(req: NextRequest) {
  const config = getOllamaConfig();
  if (!config.baseUrl || !config.model) {
    return NextResponse.json({ error: "L'assistant IA n'est pas configuré (Sécurité > Assistant IA (Ollama))." }, { status: 400 });
  }

  const { messages, context } = (await req.json()) as { messages: ChatMessage[]; context?: string };
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "Aucun message." }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        stream: true,
        messages: [{ role: "system", content: buildSystemPrompt(config, context) }, ...messages],
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Connexion au serveur Ollama impossible : ${err instanceof Error ? err.message : "erreur inconnue"}.` },
      { status: 502 }
    );
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `Le serveur Ollama a répondu avec une erreur (HTTP ${upstream.status}).` }, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
