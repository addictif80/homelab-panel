import { NextRequest, NextResponse } from "next/server";
import { getOllamaConfig, buildSystemPrompt } from "@/lib/ollama";
import { AI_TOOLS, executeAiTool } from "@/lib/aiTools";
import { logAudit } from "@/lib/db";

export const dynamic = "force-dynamic";

const AGENT_CONTEXT =
  "Tu peux consulter et piloter l'infrastructure homelab via les outils fournis. Les outils marqués comme sensibles dans leur description ne s'exécutent qu'après confirmation explicite de l'utilisateur : avant d'appeler un outil sensible, explique clairement dans ta réponse ce que tu t'apprêtes à faire et pourquoi, pour que l'utilisateur comprenne ce qu'il valide. N'invente jamais un hostId : utilise list_hosts si tu ne le connais pas déjà.";

type AgentMessage = {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  tool_name?: string;
};

/**
 * Runs exactly one model turn with tool-calling enabled. Non-sensitive tool calls (read-only:
 * listing hosts, scanning for findings) are executed inline since nothing they do needs a human
 * to approve. Sensitive tool calls (anything that can change infrastructure state) are never
 * executed here — they come back as `pending` for the client to show a confirmation UI and only
 * run for real via /api/ai/agent/execute-tool once a human clicks through.
 */
export async function POST(req: NextRequest) {
  const config = getOllamaConfig();
  if (!config.baseUrl || !config.model) {
    return NextResponse.json({ error: "L'assistant IA n'est pas configuré (Sécurité > Assistant IA (Ollama))." }, { status: 400 });
  }

  const { messages } = (await req.json()) as { messages: AgentMessage[] };
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "Aucun message." }, { status: 400 });
  }

  const ollamaTools = AI_TOOLS.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  let upstream: Response;
  try {
    upstream = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        tools: ollamaTools,
        messages: [{ role: "system", content: buildSystemPrompt(config, AGENT_CONTEXT) }, ...messages],
      }),
      signal: AbortSignal.timeout(180_000),
      cache: "no-store",
    });
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined;
    const reason = [err instanceof Error ? err.message : "erreur inconnue", cause].filter(Boolean).join(" — ");
    return NextResponse.json({ error: `Connexion au serveur Ollama impossible : ${reason}.` }, { status: 502 });
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
    return NextResponse.json(
      { error: `Le serveur Ollama a répondu avec une erreur (HTTP ${upstream.status})${detail ? ` : ${detail}` : "."}` },
      { status: 502 }
    );
  }

  const data = (await upstream.json()) as { message: AgentMessage };
  const assistantMsg = data.message;
  const toolCalls = assistantMsg.tool_calls ?? [];

  if (toolCalls.length === 0) {
    return NextResponse.json({ messages: [...messages, assistantMsg], pending: [], done: true });
  }

  const autoResultMessages: AgentMessage[] = [];
  const pending: { name: string; arguments: Record<string, unknown> }[] = [];

  for (const call of toolCalls) {
    const def = AI_TOOLS.find((t) => t.name === call.function.name);
    if (!def) {
      autoResultMessages.push({
        role: "tool",
        tool_name: call.function.name,
        content: `Erreur : outil inconnu "${call.function.name}".`,
      });
      continue;
    }
    if (def.sensitive) {
      pending.push({ name: call.function.name, arguments: call.function.arguments });
      continue;
    }
    const result = await executeAiTool(call.function.name, call.function.arguments);
    logAudit("ai.tool_auto", undefined, call.function.name);
    autoResultMessages.push({ role: "tool", tool_name: call.function.name, content: result });
  }

  return NextResponse.json({
    messages: [...messages, assistantMsg, ...autoResultMessages],
    pending,
    done: false,
  });
}
