"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";

type Ticket = { id: string; email: string; subject: string; status: "open" | "closed"; createdAt: string };
type Message = { id: string; sender: "customer" | "seller"; body: string; createdAt: string };

export default function SupportTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { id } = use(params);
  const { token } = use(searchParams);

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  function load() {
    if (!token) {
      setError("Lien invalide : le jeton d'accès est manquant.");
      return;
    }
    fetch(`/api/store/support/tickets/${id}?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setTicket(data.ticket);
        setMessages(data.messages);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Erreur."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  async function sendReply() {
    if (!reply.trim() || !token) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch(`/api/store/support/tickets/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, message: reply.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setReply("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <nav className="border-b border-neutral-800 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6">
          <Link href="/store" className="font-display text-base font-semibold">
            Homelab Panel
          </Link>
          <Link href="/store" className="text-sm text-neutral-400 hover:text-neutral-100">
            ← Retour
          </Link>
        </div>
      </nav>

      <main className="mx-auto max-w-2xl px-6 py-14">
        {error && <p className="rounded border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{error}</p>}

        {ticket && (
          <>
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h1 className="text-xl font-semibold">{ticket.subject}</h1>
                <p className="mt-1 text-sm text-neutral-500">{ticket.email}</p>
              </div>
              <span
                className={`rounded border px-2 py-1 text-xs ${
                  ticket.status === "open"
                    ? "border-emerald-900 bg-emerald-950/30 text-emerald-400"
                    : "border-neutral-700 text-neutral-500"
                }`}
              >
                {ticket.status === "open" ? "Ouvert" : "Résolu"}
              </span>
            </div>

            <div className="space-y-3">
              {messages?.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-lg border p-3.5 text-sm ${
                    m.sender === "seller"
                      ? "ml-8 border-blue-900 bg-blue-950/30 text-blue-100"
                      : "mr-8 border-neutral-800 bg-neutral-900 text-neutral-200"
                  }`}
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
                  <p className="mt-2 text-[11px] text-neutral-500">
                    {m.sender === "seller" ? "Support" : "Toi"} · {new Date(`${m.createdAt}Z`).toLocaleString("fr-FR")}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-6 space-y-2">
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={3}
                placeholder="Ajouter un message..."
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
              />
              <button
                onClick={sendReply}
                disabled={sending || !reply.trim()}
                className="btn-primary px-5 py-2 text-sm disabled:opacity-50"
              >
                {sending ? "Envoi..." : "Envoyer"}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
