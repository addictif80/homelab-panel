"use client";

import { useEffect, useState } from "react";

type TicketStatus = "open" | "closed";
type Ticket = { id: string; email: string; subject: string; status: TicketStatus; createdAt: string; updatedAt: string };
type Message = { id: string; ticketId: string; sender: "customer" | "seller"; body: string; createdAt: string };

export default function SupportTicketsPanel() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [updating, setUpdating] = useState(false);

  function loadTickets() {
    fetch("/api/seller/support/tickets")
      .then((r) => r.json())
      .then((d) => setTickets(d.tickets));
  }

  function loadThread(id: string) {
    fetch(`/api/seller/support/tickets/${id}`)
      .then((r) => r.json())
      .then((d) => setMessages(d.messages));
  }

  useEffect(() => {
    loadTickets();
  }, []);

  function open(id: string) {
    setSelected(id);
    setReply("");
    loadThread(id);
  }

  async function sendReply() {
    if (!selected || !reply.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/seller/support/tickets/${selected}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: reply.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setReply("");
      loadThread(selected);
      loadTickets();
    } finally {
      setSending(false);
    }
  }

  async function toggleStatus(ticket: Ticket) {
    setUpdating(true);
    try {
      const nextStatus: TicketStatus = ticket.status === "open" ? "closed" : "open";
      await fetch(`/api/seller/support/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      loadTickets();
    } finally {
      setUpdating(false);
    }
  }

  const selectedTicket = tickets?.find((t) => t.id === selected) ?? null;
  const openCount = tickets?.filter((t) => t.status === "open").length ?? 0;

  return (
    <section className="space-y-3 rounded border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-100">Assistance par ticket</h2>
        <span className="text-sm text-neutral-300">{openCount} ouvert{openCount !== 1 ? "s" : ""}</span>
      </div>
      <p className="text-xs text-neutral-500">
        Tickets envoyés depuis la page de vente publique. Une réponse ici est aussi envoyée par email au client, avec
        un lien pour continuer la conversation.
      </p>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="overflow-x-auto rounded border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-950 text-left text-xs text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Sujet</th>
                <th className="px-3 py-2 font-medium">Statut</th>
              </tr>
            </thead>
            <tbody>
              {tickets?.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => open(t.id)}
                  className={`cursor-pointer border-t border-neutral-900 hover:bg-neutral-800/60 ${
                    selected === t.id ? "bg-neutral-800/60" : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    <div className="text-neutral-200">{t.subject}</div>
                    <div className="text-xs text-neutral-500">{t.email}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded border px-1.5 py-0 text-[10px] ${
                        t.status === "open"
                          ? "border-emerald-900 bg-emerald-950/30 text-emerald-400"
                          : "border-neutral-700 text-neutral-500"
                      }`}
                    >
                      {t.status === "open" ? "ouvert" : "fermé"}
                    </span>
                  </td>
                </tr>
              ))}
              {tickets?.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-3 py-6 text-center text-neutral-600">
                    Aucun ticket pour l&apos;instant.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded border border-neutral-800 p-3">
          {!selectedTicket ? (
            <p className="py-6 text-center text-sm text-neutral-600">Sélectionne un ticket pour voir la conversation.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-neutral-100">{selectedTicket.subject}</p>
                  <p className="text-xs text-neutral-500">{selectedTicket.email}</p>
                </div>
                <button
                  onClick={() => toggleStatus(selectedTicket)}
                  disabled={updating}
                  className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800 disabled:opacity-50"
                >
                  {selectedTicket.status === "open" ? "Marquer résolu" : "Rouvrir"}
                </button>
              </div>

              <div className="max-h-72 space-y-2 overflow-y-auto rounded border border-neutral-900 bg-neutral-950 p-3">
                {messages?.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded p-2 text-sm ${
                      m.sender === "seller" ? "ml-6 bg-blue-950/40 text-blue-100" : "mr-6 bg-neutral-800 text-neutral-200"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    <p className="mt-1 text-[10px] text-neutral-500">
                      {m.sender === "seller" ? "Toi" : "Client"} · {new Date(`${m.createdAt}Z`).toLocaleString("fr-FR")}
                    </p>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={2}
                  placeholder="Ta réponse..."
                  className="flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
                />
                <button
                  onClick={sendReply}
                  disabled={sending || !reply.trim()}
                  className="self-end rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-900/60 disabled:opacity-50"
                >
                  {sending ? "Envoi..." : "Répondre"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
