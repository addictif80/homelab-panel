import { getSetting, setSetting } from "./db";
import { getOllamaConfig, buildSystemPrompt, askOllama, isOllamaConfigured, type ChatMessage } from "./ollama";
import {
  isOneMinConfigured,
  askOneMin,
  streamOneMinChat,
  runOneMinAgentTurn,
  type AgentMessage,
  type AgentToolDef,
} from "./oneMinAi";

export type AiProvider = "ollama" | "1min";

const PROVIDER_KEY = "ai_provider";

export function getAiProvider(): AiProvider {
  return getSetting(PROVIDER_KEY) === "1min" ? "1min" : "ollama";
}

export function setAiProvider(provider: AiProvider): void {
  setSetting(PROVIDER_KEY, provider);
}

export function isAiConfigured(): boolean {
  return getAiProvider() === "1min" ? isOneMinConfigured() : isOllamaConfigured();
}

export const AI_NOT_CONFIGURED_MESSAGE = "L'assistant IA n'est pas configuré (Réglages > Assistant IA).";

/** The response-language preference lives on the Ollama config today (lib/ollama.ts) but is really
 * a user preference, not something specific to that provider — reused as-is for 1min.ai rather
 * than duplicating a second language setting or silently hardcoding "fr" for that provider. */
function activeLanguage(): string {
  return getOllamaConfig().language;
}

/** One-shot, non-streaming completion — used by the proactive-insight digest and the
 * natural-language provisioning helper, neither of which need streaming output. */
export async function askAi(userMessage: string, extraContext?: string): Promise<string> {
  if (getAiProvider() === "1min") {
    // buildSystemPrompt is provider-agnostic text generation (no Ollama-specific fields used
    // beyond `language`, which 1min.ai's config doesn't carry) — reuse it with a fixed "fr"
    // default rather than duplicating the prompt text in oneMinAi.ts.
    return askOneMin(buildSystemPrompt({ baseUrl: "", model: "", language: activeLanguage() }, extraContext), userMessage);
  }
  return askOllama(userMessage, extraContext);
}

export type { ChatMessage };

/** Streaming chat for /api/ai/chat — always resolves to the same ndjson-over-HTTP Response shape
 * regardless of provider, so the route (and every client consuming it) stays provider-agnostic. */
export async function streamAiChat(
  messages: ChatMessage[],
  context?: string
): Promise<{ response: Response } | { error: string; status: number }> {
  if (getAiProvider() === "1min") {
    const systemPrompt = buildSystemPrompt({ baseUrl: "", model: "", language: activeLanguage() }, context);
    const result = await streamOneMinChat(systemPrompt, messages);
    if ("error" in result) return result;
    return {
      response: new Response(result.stream, {
        headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
      }),
    };
  }

  const config = getOllamaConfig();
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
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined;
    const reason = [err instanceof Error ? err.message : "erreur inconnue", cause].filter(Boolean).join(" — ");
    return { error: `Connexion au serveur Ollama impossible : ${reason}.`, status: 502 };
  }
  if (!upstream.ok || !upstream.body) {
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
    return {
      error: `Le serveur Ollama a répondu avec une erreur (HTTP ${upstream.status})${detail ? ` : ${detail}` : "."}`,
      status: 502,
    };
  }
  return {
    response: new Response(upstream.body, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
    }),
  };
}

export type { AgentMessage, AgentToolDef };

/** One tool-calling turn for /api/ai/agent — same normalized shape (tool_calls[].function.arguments
 * already parsed as an object) regardless of provider; see oneMinAi.ts's runOneMinAgentTurn for why
 * that normalization matters specifically for the 1min.ai/OpenAI-shaped path. */
export async function runAgentTurn(
  messages: AgentMessage[],
  tools: AgentToolDef[],
  context: string
): Promise<{ message: AgentMessage } | { error: string; status: number }> {
  if (getAiProvider() === "1min") {
    const systemPrompt = buildSystemPrompt({ baseUrl: "", model: "", language: activeLanguage() }, context);
    return runOneMinAgentTurn(systemPrompt, messages, tools);
  }

  const config = getOllamaConfig();
  const ollamaTools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  let upstream: Response;
  try {
    upstream = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        tools: ollamaTools,
        messages: [{ role: "system", content: buildSystemPrompt(config, context) }, ...messages],
      }),
      signal: AbortSignal.timeout(180_000),
      cache: "no-store",
    });
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined;
    const reason = [err instanceof Error ? err.message : "erreur inconnue", cause].filter(Boolean).join(" — ");
    return { error: `Connexion au serveur Ollama impossible : ${reason}.`, status: 502 };
  }
  if (!upstream.ok) {
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
    return {
      error: `Le serveur Ollama a répondu avec une erreur (HTTP ${upstream.status})${detail ? ` : ${detail}` : "."}`,
      status: 502,
    };
  }
  const data = (await upstream.json()) as { message: AgentMessage };
  return { message: data.message };
}
