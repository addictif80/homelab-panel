import { NextRequest, NextResponse } from "next/server";
import { getOllamaConfig, buildSystemPrompt, type ChatMessage } from "@/lib/ollama";

// Opts this route out of Next.js's route-level fetch caching/memoization — the upstream call
// must run fresh, streamed straight through, every single time, never served from a cache entry.
export const dynamic = "force-dynamic";

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
      cache: "no-store",
    });
  } catch (err) {
    // "fetch failed" from undici is a generic wrapper — the actionable detail (ECONNREFUSED,
    // ECONNRESET, DNS failure...) lives one level down in `cause`, so surface that too rather
    // than just the opaque top-level message.
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined;
    const reason = [err instanceof Error ? err.message : "erreur inconnue", cause].filter(Boolean).join(" — ");
    return NextResponse.json({ error: `Connexion au serveur Ollama impossible : ${reason}.` }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    // Ollama's own error responses are JSON like {"error":"model 'x' not found, try pulling it
    // first"} — read it instead of throwing away the one piece of information that actually
    // explains a 500 (missing model, out of memory, unsupported request shape...).
    const detail = await upstream
      .text()
      .then((text) => {
        try {
          return (JSON.parse(text) as { error?: string }).error ?? text;
        } catch {
          return text;
        }
      })
      .catch(() => "");
    return NextResponse.json(
      { error: `Le serveur Ollama a répondu avec une erreur (HTTP ${upstream.status})${detail ? ` : ${detail}` : "."}` },
      { status: 502 }
    );
  }

  return new Response(upstream.body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
