"use client";

import { useCallback, useEffect, useState } from "react";

type MailEvent = {
  id: number;
  ipAddress: string | null;
  senderEmail: string | null;
  subject: string | null;
  receivedAt: string;
};

type BlockedSender = { email: string; blockedAt: string };

export default function MailSecurityPage() {
  const [events, setEvents] = useState<MailEvent[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [blockedSenders, setBlockedSenders] = useState<BlockedSender[]>([]);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const params = q ? `?q=${encodeURIComponent(q)}` : "";
      const res = await fetch(`/api/security/mail-log${params}`);
      const data = await res.json();
      setEvents(data.events ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadBlockedSenders = useCallback(async () => {
    const res = await fetch("/api/security/blocked-senders");
    const data = await res.json();
    setBlockedSenders(data.blockedSenders ?? []);
  }, []);

  useEffect(() => {
    load(search);
  }, [load, search]);

  useEffect(() => {
    loadBlockedSenders();
  }, [loadBlockedSenders]);

  async function block(event: MailEvent) {
    if (!event.ipAddress && !event.senderEmail) return;
    const label = [event.ipAddress, event.senderEmail].filter(Boolean).join(" / ");
    if (!confirm(`Bloquer ${label} sur toutes les machines gérées ?`)) return;
    setBusyId(event.id);
    try {
      const res = await fetch("/api/security/mail-log/block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: event.ipAddress, email: event.senderEmail }),
      });
      const data = await res.json();
      alert(data.message || data.error || "Terminé.");
      loadBlockedSenders();
    } finally {
      setBusyId(null);
    }
  }

  async function unblockSender(email: string) {
    if (!confirm(`Débloquer ${email} ?`)) return;
    const res = await fetch("/api/security/blocked-senders/unblock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    alert(data.message || data.error || "Terminé.");
    loadBlockedSenders();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Anti-spam mail</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Historique des mails reçus (IP, expéditeur, sujet) — configurez les sources dans Réglages. Bloquer une
            ligne bannit l&apos;IP (pare-feu, sur toutes les machines) et l&apos;adresse d&apos;expédition (liste
            Postfix) simultanément.
          </p>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher IP, expéditeur, sujet..."
          className="w-64 rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600"
        />
      </div>

      <div className="overflow-x-auto rounded border border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">Date &amp; heure</th>
              <th className="px-3 py-2 font-medium">Adresse IP</th>
              <th className="px-3 py-2 font-medium">Expéditeur</th>
              <th className="px-3 py-2 font-medium">Sujet</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-t border-neutral-900">
                <td className="whitespace-nowrap px-3 py-2 text-neutral-500">
                  {new Date(e.receivedAt).toLocaleString("fr-FR")}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-neutral-200">{e.ipAddress || "—"}</td>
                <td className="px-3 py-2 text-neutral-300">{e.senderEmail || "—"}</td>
                <td className="max-w-md truncate px-3 py-2 text-neutral-500" title={e.subject || ""}>
                  {e.subject || "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => block(e)}
                    disabled={busyId === e.id || (!e.ipAddress && !e.senderEmail)}
                    className="rounded border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40 disabled:opacity-50"
                  >
                    Bloquer
                  </button>
                </td>
              </tr>
            ))}
            {events.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-neutral-600">
                  Aucun mail détecté pour l&apos;instant — vérifiez qu&apos;une source de logs est configurée dans
                  Réglages &gt; Anti-spam mail.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {blockedSenders.length > 0 && (
        <section className="space-y-2 rounded border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="text-sm font-semibold text-neutral-100">Adresses bloquées ({blockedSenders.length})</h2>
          <div className="divide-y divide-neutral-800 rounded border border-neutral-800">
            {blockedSenders.map((b) => (
              <div key={b.email} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="font-mono text-xs text-neutral-200">{b.email}</span>
                <button
                  onClick={() => unblockSender(b.email)}
                  className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                >
                  Débloquer
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
