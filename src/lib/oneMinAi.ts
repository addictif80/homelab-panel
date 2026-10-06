import { getSetting, setSetting } from "./db";
import { vaultDecrypt, vaultEncrypt } from "./crypto";

// 1min.ai's OpenAI-compatible endpoint (/openai/v1/*) — same request/response shape as OpenAI's
// own Chat Completions API (including SSE streaming and function-calling), just pointed at a
// different host/key. See https://docs.1min.ai/docs/api/intro.
const SETTING_KEY = "onemin_config";
export const ONE_MIN_API_BASE = "https://api.1min.ai";

export type OneMinConfig = { apiKey: string; model: string };

const DEFAULT_CONFIG: OneMinConfig = { apiKey: "", model: "gpt-4o-mini" };

export function getOneMinConfig(): OneMinConfig {
  const raw = getSetting(SETTING_KEY);
  if (!raw) return DEFAULT_CONFIG;
  try {
    return { ...DEFAULT_CONFIG, ...(JSON.parse(vaultDecrypt(raw)) as Partial<OneMinConfig>) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** The API key is a secret credential like any other in this panel (SMTP password, Stripe key,
 * Tailscale key...) — stored vault-encrypted, never in plaintext, same convention throughout. */
export function setOneMinConfig(config: OneMinConfig): void {
  setSetting(SETTING_KEY, vaultEncrypt(JSON.stringify(config)));
}

export function isOneMinConfigured(): boolean {
  const config = getOneMinConfig();
  return Boolean(config.apiKey && config.model);
}

export type OneMinTestResult = { ok: boolean; message: string };

/** A cheap, minimal real completion (1 token) rather than hitting some lighter "whoami" endpoint
 * that doesn't exist on 1min.ai — this is the same request shape every other call here makes, so
 * success here means the actual feature will actually work, not just that the key parses. */
export async function testOneMinConnection(config: OneMinConfig): Promise<OneMinTestResult> {
  if (!config.apiKey.trim()) return { ok: false, message: "Clé API manquante." };
  try {
    const res = await fetch(`${ONE_MIN_API_BASE}/openai/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey.trim()}` },
      body: JSON.stringify({
        model: config.model || DEFAULT_CONFIG.model,
        stream: false,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        ok: false,
        message: `Le serveur a répondu avec une erreur (HTTP ${res.status})${detail ? ` : ${detail.slice(0, 300)}` : "."}`,
      };
    }
    return { ok: true, message: "Connexion réussie." };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Erreur inconnue.";
    return { ok: false, message: `Connexion impossible : ${reason}` };
  }
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

function authHeaders(config: OneMinConfig): HeadersInit {
  return { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` };
}

/** One-shot, non-streaming completion — mirrors lib/ollama.ts's askOllama so the two providers
 * are interchangeable from a caller's point of view (see lib/aiProvider.ts). */
export async function askOneMin(systemPrompt: string, userMessage: string): Promise<string> {
  const config = getOneMinConfig();
  if (!config.apiKey || !config.model) {
    throw new Error("L'assistant IA n'est pas configuré (Réglages > Assistant IA).");
  }
  const res = await fetch(`${ONE_MIN_API_BASE}/openai/v1/chat/completions`, {
    method: "POST",
    headers: authHeaders(config),
    body: JSON.stringify({
      model: config.model,
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`1min.ai a répondu avec une erreur (HTTP ${res.status}).`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Streams a chat completion and re-encodes it as the exact same newline-delimited JSON shape
 * Ollama's own /api/chat produces (`{"message":{"content":"..."},"done":false}` per line, then a
 * final `{"message":{"content":""},"done":true}`) — so /api/ai/chat's response format, and
 * therefore every client that already consumes it, needs zero changes to support this provider.
 * 1min.ai's OpenAI-compatible endpoint streams standard OpenAI-style SSE
 * (`data: {...}\n\n`, delta.content, terminated by `data: [DONE]`), which this decodes as it goes.
 */
export async function streamOneMinChat(
  systemPrompt: string,
  messages: ChatMessage[]
): Promise<{ stream: ReadableStream<Uint8Array> } | { error: string; status: number }> {
  const config = getOneMinConfig();
  if (!config.apiKey || !config.model) {
    return { error: "L'assistant IA n'est pas configuré (Réglages > Assistant IA).", status: 400 };
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${ONE_MIN_API_BASE}/openai/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(config),
      body: JSON.stringify({
        model: config.model,
        stream: true,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
      signal: AbortSignal.timeout(180_000),
      cache: "no-store",
    });
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined;
    const reason = [err instanceof Error ? err.message : "erreur inconnue", cause].filter(Boolean).join(" — ");
    return { error: `Connexion à 1min.ai impossible : ${reason}.`, status: 502 };
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return {
      error: `1min.ai a répondu avec une erreur (HTTP ${upstream.status})${detail ? ` : ${detail.slice(0, 300)}` : "."}`,
      status: 502,
    };
  }

  const upstreamBody = upstream.body;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstreamBody.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === "[DONE]") {
              controller.enqueue(encoder.encode(`${JSON.stringify({ message: { content: "" }, done: true })}\n`));
              continue;
            }
            try {
              const parsed = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                controller.enqueue(encoder.encode(`${JSON.stringify({ message: { content }, done: false })}\n`));
              }
            } catch {
              // A non-JSON or partial SSE line (keep-alive comment, etc.) — ignore and keep reading.
            }
          }
        }
      } finally {
        controller.close();
      }
    },
  });

  return { stream };
}

export type AgentToolDef = { name: string; description: string; parameters: unknown };
export type AgentMessage = {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  tool_name?: string;
};

/**
 * Runs one non-streaming turn with tool-calling — mirrors /api/ai/agent's direct Ollama call.
 * OpenAI's (and so 1min.ai's) function-calling shape is nearly identical to Ollama's, with one
 * real difference this normalizes away: `tool_calls[].function.arguments` comes back as a JSON
 * *string*, not an already-parsed object — every caller downstream (executeAiTool, the pending
 * confirmation queue) expects a parsed object, same as Ollama already hands back.
 */
export async function runOneMinAgentTurn(
  systemPrompt: string,
  messages: AgentMessage[],
  tools: AgentToolDef[]
): Promise<{ message: AgentMessage } | { error: string; status: number }> {
  const config = getOneMinConfig();
  if (!config.apiKey || !config.model) {
    return { error: "L'assistant IA n'est pas configuré (Réglages > Assistant IA).", status: 400 };
  }

  const openAiTools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

  let upstream: Response;
  try {
    upstream = await fetch(`${ONE_MIN_API_BASE}/openai/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(config),
      body: JSON.stringify({
        model: config.model,
        stream: false,
        tools: openAiTools,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
      signal: AbortSignal.timeout(180_000),
      cache: "no-store",
    });
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined;
    const reason = [err instanceof Error ? err.message : "erreur inconnue", cause].filter(Boolean).join(" — ");
    return { error: `Connexion à 1min.ai impossible : ${reason}.`, status: 502 };
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return {
      error: `1min.ai a répondu avec une erreur (HTTP ${upstream.status})${detail ? ` : ${detail.slice(0, 300)}` : "."}`,
      status: 502,
    };
  }

  const data = (await upstream.json()) as {
    choices?: { message?: { content?: string | null; tool_calls?: { function: { name: string; arguments: string } }[] } }[];
  };
  const raw = data.choices?.[0]?.message;
  const message: AgentMessage = {
    role: "assistant",
    content: raw?.content ?? "",
    tool_calls: raw?.tool_calls?.map((tc) => ({
      function: {
        name: tc.function.name,
        arguments: safeParseJsonObject(tc.function.arguments),
      },
    })),
  };
  return { message };
}

function safeParseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
