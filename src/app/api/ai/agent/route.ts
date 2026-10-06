import { NextRequest, NextResponse } from "next/server";
import { isAiConfigured, runAgentTurn, AI_NOT_CONFIGURED_MESSAGE, type AgentMessage } from "@/lib/aiProvider";
import { AI_TOOLS, executeAiTool } from "@/lib/aiTools";
import { logAudit } from "@/lib/db";

export const dynamic = "force-dynamic";

const AGENT_CONTEXT =
  "Tu peux consulter et piloter l'infrastructure homelab via les outils fournis. Les outils marqués comme sensibles dans leur description ne s'exécutent qu'après confirmation explicite de l'utilisateur : avant d'appeler un outil sensible, explique clairement dans ta réponse ce que tu t'apprêtes à faire et pourquoi, pour que l'utilisateur comprenne ce qu'il valide. N'invente jamais un hostId : utilise list_hosts si tu ne le connais pas déjà.";

/**
 * Runs exactly one model turn with tool-calling enabled (see lib/aiProvider.ts for how this is
 * dispatched to whichever provider — Ollama or 1min.ai — is configured). Non-sensitive tool calls
 * (read-only: listing hosts, scanning for findings) are executed inline since nothing they do
 * needs a human to approve. Sensitive tool calls (anything that can change infrastructure state)
 * are never executed here — they come back as `pending` for the client to show a confirmation UI
 * and only run for real via /api/ai/agent/execute-tool once a human clicks through.
 */
export async function POST(req: NextRequest) {
  if (!isAiConfigured()) {
    return NextResponse.json({ error: AI_NOT_CONFIGURED_MESSAGE }, { status: 400 });
  }

  const { messages } = (await req.json()) as { messages: AgentMessage[] };
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "Aucun message." }, { status: 400 });
  }

  const result = await runAgentTurn(messages, AI_TOOLS, AGENT_CONTEXT);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const assistantMsg = result.message;
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
    const toolResult = await executeAiTool(call.function.name, call.function.arguments);
    logAudit("ai.tool_auto", undefined, call.function.name);
    autoResultMessages.push({ role: "tool", tool_name: call.function.name, content: toolResult });
  }

  return NextResponse.json({
    messages: [...messages, assistantMsg, ...autoResultMessages],
    pending,
    done: false,
  });
}
