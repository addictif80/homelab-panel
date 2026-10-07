"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { streamOllamaChat, type ChatTurn } from "@/lib/ollamaClient";

type Message = ChatTurn & { id: string; error?: boolean };

type AgentToolCall = { function: { name: string; arguments: Record<string, unknown> } };
type AgentMessage = {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  tool_calls?: AgentToolCall[];
  tool_name?: string;
};
type PendingCall = { name: string; arguments: Record<string, unknown> };
type ConversationSummary = { id: string; kind: "chat" | "agent"; title: string; updatedAt: string };

const MAX_AGENT_ITERATIONS = 8;

let seq = 0;
function nextId(): string {
  seq += 1;
  return `m${Date.now()}-${seq}`;
}

function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return "(aucun paramètre)";
  return entries.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join(", ");
}

export default function AssistantPage() {
  const [aiStatus, setAiStatus] = useState<{ configured: boolean; label: string | null } | null>(null);
  const [mode, setMode] = useState<"chat" | "agent">("chat");

  // Plain conversation mode
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  // Agent (pilotage) mode
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [agentInput, setAgentInput] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [pending, setPending] = useState<PendingCall[]>([]);
  const [agentError, setAgentError] = useState("");

  // History — one saved conversation list per mode, the active one currently loaded (null = not
  // saved yet, the very first message of a fresh conversation creates it).
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshConversations = useCallback(async (kind: "chat" | "agent") => {
    const res = await fetch(`/api/assistant/conversations?kind=${kind}`);
    const data = await res.json();
    setConversations(data.conversations ?? []);
  }, []);

  useEffect(() => {
    fetch("/api/settings/ai-status")
      .then((r) => r.json())
      .then((data) => setAiStatus({ configured: data.configured, label: data.label }));
    refreshConversations("chat");
  }, [refreshConversations]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, agentMessages, pending]);

  const configured = Boolean(aiStatus?.configured);

  /** Creates the conversation on first save (returning its new id) or updates it on every save
   * after — threaded through a local `idHint` (not read from the `activeId` state) because a
   * single turn calls this twice (right after the user's message, then again once the reply is
   * complete) and the second call must target the row the first one just created, not race the
   * state update and create a second row for the same turn. */
  async function persist(id: string | null, kind: "chat" | "agent", msgs: (Message | AgentMessage)[]): Promise<string> {
    if (id) {
      await fetch(`/api/assistant/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs }),
      });
      return id;
    }
    const res = await fetch("/api/assistant/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, messages: msgs }),
    });
    const data = await res.json();
    setActiveId(data.conversation.id);
    refreshConversations(kind);
    return data.conversation.id;
  }

  async function loadConversation(summary: ConversationSummary) {
    const res = await fetch(`/api/assistant/conversations/${summary.id}`);
    const data = await res.json();
    if (!res.ok) return;
    setMode(summary.kind);
    setActiveId(summary.id);
    if (summary.kind === "chat") {
      setMessages(data.conversation.messages);
    } else {
      setAgentMessages(data.conversation.messages);
      setPending([]);
      setAgentError("");
    }
  }

  async function removeConversation(id: string, kind: "chat" | "agent") {
    await fetch(`/api/assistant/conversations/${id}`, { method: "DELETE" });
    if (id === activeId) {
      setActiveId(null);
      if (kind === "chat") setMessages([]);
      else {
        setAgentMessages([]);
        setPending([]);
      }
    }
    refreshConversations(kind);
  }

  async function switchMode(next: "chat" | "agent") {
    setMode(next);
    refreshConversations(next);
  }

  async function send() {
    const text = input.trim();
    if (!text || sending || !configured) return;
    setInput("");
    const userMsg: Message = { id: nextId(), role: "user", content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setSending(true);
    const convId = await persist(activeId, "chat", history);

    const assistantId = nextId();
    let finalText = "";
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);

    try {
      await streamOllamaChat(
        history.map((m) => ({ role: m.role, content: m.content })),
        undefined,
        (token) => {
          finalText += token;
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + token } : m)));
        }
      );
      await persist(convId, "chat", [...history, { id: assistantId, role: "assistant", content: finalText }]);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Erreur de l'assistant IA.";
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, error: true, content: errorText } : m)));
      await persist(convId, "chat", [...history, { id: assistantId, role: "assistant", content: errorText, error: true }]);
    } finally {
      setSending(false);
    }
  }

  function newConversation() {
    setMessages([]);
    setActiveId(null);
  }

  async function runAgentTurn(msgs: AgentMessage[], convId: string, iteration = 0) {
    if (iteration > MAX_AGENT_ITERATIONS) {
      setAgentError("Trop d'étapes enchaînées sans réponse finale — l'IA doit reformuler sa demande.");
      setAgentBusy(false);
      return;
    }
    setAgentBusy(true);
    setAgentError("");
    try {
      const res = await fetch("/api/ai/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur.");
      setAgentMessages(data.messages);
      await persist(convId, "agent", data.messages);
      if (data.pending.length > 0) {
        setPending(data.pending);
        setAgentBusy(false);
        return;
      }
      if (!data.done) {
        await runAgentTurn(data.messages, convId, iteration + 1);
        return;
      }
      setAgentBusy(false);
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : "Erreur de l'assistant IA.");
      setAgentBusy(false);
    }
  }

  async function sendAgent() {
    const text = agentInput.trim();
    if (!text || agentBusy || !configured) return;
    setAgentInput("");
    const newMessages: AgentMessage[] = [...agentMessages, { role: "user", content: text }];
    setAgentMessages(newMessages);
    const convId = await persist(activeId, "agent", newMessages);
    await runAgentTurn(newMessages, convId);
  }

  async function resolvePending(index: number, approve: boolean) {
    const item = pending[index];
    setAgentBusy(true);
    let resultContent: string;
    if (approve) {
      try {
        const res = await fetch("/api/ai/agent/execute-tool", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: item.name, arguments: item.arguments }),
        });
        const data = await res.json();
        resultContent = res.ok ? data.content : `Erreur : ${data.error}`;
      } catch (err) {
        resultContent = `Erreur : ${err instanceof Error ? err.message : "erreur inconnue"}.`;
      }
    } else {
      resultContent = "Action refusée par l'utilisateur.";
    }

    const remaining = pending.filter((_, i) => i !== index);
    setPending(remaining);
    const updated: AgentMessage[] = [...agentMessages, { role: "tool", tool_name: item.name, content: resultContent }];
    setAgentMessages(updated);
    const convId = await persist(activeId, "agent", updated);

    if (remaining.length === 0) {
      await runAgentTurn(updated, convId);
    } else {
      setAgentBusy(false);
    }
  }

  function newAgentConversation() {
    setAgentMessages([]);
    setPending([]);
    setAgentError("");
    setActiveId(null);
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-3rem)] max-w-5xl flex-col gap-4 p-4 sm:flex-row">
      <aside className="flex max-h-48 shrink-0 flex-col gap-1 overflow-y-auto border-b border-neutral-800 pb-3 sm:max-h-none sm:w-56 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Historique</p>
        {conversations.length === 0 && <p className="text-xs text-neutral-600">Aucune conversation enregistrée.</p>}
        {conversations.map((c) => (
          <div
            key={c.id}
            className={`group flex items-center justify-between gap-1 rounded px-2 py-1.5 text-xs ${
              c.id === activeId ? "bg-neutral-800 text-neutral-100" : "text-neutral-400 hover:bg-neutral-900"
            }`}
          >
            <button onClick={() => loadConversation(c)} className="flex-1 truncate text-left" title={c.title}>
              {c.title}
            </button>
            <button
              onClick={() => removeConversation(c.id, c.kind)}
              className="shrink-0 text-neutral-600 opacity-0 hover:text-red-400 group-hover:opacity-100"
              title="Supprimer"
            >
              ✕
            </button>
          </div>
        ))}
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-neutral-100">Assistant IA</h1>
            <p className="text-xs text-neutral-500">
              {configured ? (
                <>Connecté à {aiStatus?.label}</>
              ) : (
                <>
                  Non configuré —{" "}
                  <Link href="/settings" className="text-blue-400 hover:underline">
                    configure l&apos;assistant IA dans Réglages
                  </Link>
                  .
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded border border-neutral-700 text-xs">
              <button
                onClick={() => switchMode("chat")}
                className={`px-3 py-1.5 ${mode === "chat" ? "bg-neutral-800 text-neutral-100" : "text-neutral-400 hover:bg-neutral-900"}`}
              >
                Conversation
              </button>
              <button
                onClick={() => switchMode("agent")}
                className={`border-l border-neutral-700 px-3 py-1.5 ${mode === "agent" ? "bg-purple-950/50 text-purple-200" : "text-neutral-400 hover:bg-neutral-900"}`}
              >
                Pilotage
              </button>
            </div>
            <button
              onClick={mode === "chat" ? newConversation : newAgentConversation}
              className="rounded border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
            >
              Nouvelle conversation
            </button>
          </div>
        </div>

        {mode === "agent" && (
          <p className="mb-3 rounded border border-purple-900 bg-purple-950/20 p-2 text-xs text-purple-300">
            En mode pilotage, l&apos;IA peut consulter l&apos;état de tes machines et agir dessus (commandes SSH,
            correctifs, blocage d&apos;IP). Toute action qui modifie quelque chose t&apos;est présentée en détail avant
            exécution — rien ne se lance sans ta confirmation explicite. Elle peut aussi répondre en direct à des
            questions chiffrées sur tes propres données (ex. &laquo; est-ce que mes sauvegardes respectent la règle
            3-2-1 ? &raquo;, &laquo; combien me coûte mon infra en électricité ? &raquo;, &laquo; y a-t-il eu des
            coupures internet ce mois-ci ? &raquo;) — jamais en devinant, toujours en interrogeant les vraies données
            du panel.
          </p>
        )}

        {mode === "chat" ? (
          <>
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto rounded border border-neutral-800 bg-neutral-950 p-4">
              {messages.length === 0 && (
                <p className="text-sm text-neutral-600">
                  Pose une question sur ton infrastructure, un service, une commande à lancer...
                </p>
              )}
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[85%] whitespace-pre-wrap rounded border p-3 text-sm ${
                    m.role === "user"
                      ? "ml-auto border-blue-900 bg-blue-950/30 text-blue-100"
                      : m.error
                        ? "border-red-900 bg-red-950/30 text-red-300"
                        : "border-neutral-700 bg-neutral-900 text-neutral-200"
                  }`}
                >
                  {m.content || (m.role === "assistant" ? "…" : "")}
                </div>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                disabled={!configured || sending}
                placeholder={configured ? "Écris ton message... (Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne)" : "Configure l'assistant IA pour commencer."}
                rows={2}
                className="flex-1 resize-none rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 disabled:opacity-50"
              />
              <button
                onClick={send}
                disabled={!configured || sending || !input.trim()}
                className="rounded border border-blue-700 bg-blue-900/40 px-4 py-2 text-sm text-blue-200 hover:bg-blue-900/60 disabled:opacity-50"
              >
                {sending ? "..." : "Envoyer"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto rounded border border-neutral-800 bg-neutral-950 p-4">
              {agentMessages.length === 0 && pending.length === 0 && (
                <p className="text-sm text-neutral-600">
                  Demande par exemple : "quelles machines as-tu dans l&apos;inventaire ?" ou "regarde les problèmes de
                  sécurité sur ma Freebox".
                </p>
              )}
              {agentMessages.map((m, i) => {
                if (m.role === "tool") {
                  return (
                    <div key={i} className="max-w-[90%] rounded border border-neutral-800 bg-neutral-900/60 p-2 text-xs text-neutral-400">
                      <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-neutral-500">
                        Résultat — {m.tool_name}
                      </div>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono">{m.content.slice(0, 2000)}</pre>
                    </div>
                  );
                }
                if (m.role !== "user" && m.role !== "assistant") return null;
                return (
                  <div
                    key={i}
                    className={`max-w-[85%] whitespace-pre-wrap rounded border p-3 text-sm ${
                      m.role === "user" ? "ml-auto border-blue-900 bg-blue-950/30 text-blue-100" : "border-neutral-700 bg-neutral-900 text-neutral-200"
                    }`}
                  >
                    {m.content}
                    {m.tool_calls?.map((call, j) => (
                      <div key={j} className="mt-2 rounded border border-neutral-700 bg-black/30 px-2 py-1 font-mono text-[11px] text-neutral-400">
                        🔧 {call.function.name}({formatArgs(call.function.arguments)})
                      </div>
                    ))}
                  </div>
                );
              })}

              {pending.map((p, i) => (
                <div key={i} className="max-w-[90%] rounded border border-amber-800 bg-amber-950/20 p-3 text-sm">
                  <p className="text-amber-300">L&apos;IA veut exécuter une action qui nécessite ta confirmation :</p>
                  <pre className="mt-2 overflow-x-auto rounded border border-amber-900 bg-black/40 p-2 font-mono text-xs text-amber-200">
                    {p.name}({formatArgs(p.arguments)})
                  </pre>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => resolvePending(i, true)}
                      disabled={agentBusy}
                      className="rounded border border-emerald-700 bg-emerald-900/40 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-900/60 disabled:opacity-50"
                    >
                      Exécuter
                    </button>
                    <button
                      onClick={() => resolvePending(i, false)}
                      disabled={agentBusy}
                      className="rounded border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
                    >
                      Refuser
                    </button>
                  </div>
                </div>
              ))}

              {agentError && <p className="rounded border border-red-900 bg-red-950/30 p-2 text-xs text-red-300">{agentError}</p>}
              {agentBusy && pending.length === 0 && <p className="text-xs text-neutral-500">L&apos;IA réfléchit...</p>}
            </div>

            <div className="mt-3 flex gap-2">
              <textarea
                value={agentInput}
                onChange={(e) => setAgentInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendAgent();
                  }
                }}
                disabled={!configured || agentBusy || pending.length > 0}
                placeholder={configured ? "Décris ce que tu veux consulter ou faire sur l'infrastructure..." : "Configure l'assistant IA pour commencer."}
                rows={2}
                className="flex-1 resize-none rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 disabled:opacity-50"
              />
              <button
                onClick={sendAgent}
                disabled={!configured || agentBusy || pending.length > 0 || !agentInput.trim()}
                className="rounded border border-purple-700 bg-purple-900/40 px-4 py-2 text-sm text-purple-200 hover:bg-purple-900/60 disabled:opacity-50"
              >
                {agentBusy ? "..." : "Envoyer"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
