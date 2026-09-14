"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { streamOllamaChat, type ChatTurn } from "@/lib/ollamaClient";

type Message = ChatTurn & { id: string; error?: boolean };

const STORAGE_KEY = "homelab-assistant-conversation";

let seq = 0;
function nextId(): string {
  seq += 1;
  return `m${Date.now()}-${seq}`;
}

export default function AssistantPage() {
  const [config, setConfig] = useState<{ baseUrl: string; model: string; language: string } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/settings/ollama")
      .then((r) => r.json())
      .then((data) => setConfig(data.config));
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) setMessages(JSON.parse(saved));
    } catch {
      // corrupted/unavailable sessionStorage just means starting from an empty conversation
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // storage full/unavailable — the conversation just won't survive a reload, not fatal
    }
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const configured = Boolean(config?.baseUrl && config?.model);

  async function send() {
    const text = input.trim();
    if (!text || sending || !configured) return;
    setInput("");
    const userMsg: Message = { id: nextId(), role: "user", content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setSending(true);

    const assistantId = nextId();
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);

    try {
      await streamOllamaChat(
        history.map((m) => ({ role: m.role, content: m.content })),
        undefined,
        (token) => {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + token } : m)));
        }
      );
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, error: true, content: err instanceof Error ? err.message : "Erreur de l'assistant IA." }
            : m
        )
      );
    } finally {
      setSending(false);
    }
  }

  function newConversation() {
    setMessages([]);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-3rem)] max-w-3xl flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Assistant IA</h1>
          <p className="text-xs text-neutral-500">
            {configured ? (
              <>Connecté à {config?.model} sur {config?.baseUrl}</>
            ) : (
              <>
                Non configuré —{" "}
                <Link href="/security" className="text-blue-400 hover:underline">
                  configure Ollama dans Sécurité
                </Link>
                .
              </>
            )}
          </p>
        </div>
        <button
          onClick={newConversation}
          className="rounded border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
        >
          Nouvelle conversation
        </button>
      </div>

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
          placeholder={configured ? "Écris ton message... (Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne)" : "Configure Ollama pour commencer."}
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
    </div>
  );
}
