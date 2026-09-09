"use client";

import { useEffect, useState } from "react";

type Domain = { id: string; domain: string; port: number };

export default function CertificateWatchPanel({ onChanged }: { onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const [domains, setDomains] = useState<Domain[] | null>(null);
  const [newDomain, setNewDomain] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/settings/certificates")
      .then((r) => r.json())
      .then((d) => setDomains(d.domains));
  }

  useEffect(() => {
    if (open && !domains) load();
  }, [open, domains]);

  async function add() {
    if (!newDomain.trim()) return;
    setAdding(true);
    setError("");
    try {
      const res = await fetch("/api/settings/certificates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: newDomain.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNewDomain("");
      load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/settings/certificates/${id}`, { method: "DELETE" });
    load();
    onChanged?.();
  }

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-neutral-300"
      >
        <span>Domaines surveillés (expiration des certificats SSL)</span>
        <span className="text-neutral-500">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-neutral-800 p-4">
          <p className="text-xs text-neutral-500">
            Le panel se connecte directement à ces domaines en HTTPS pour vérifier la date d&apos;expiration du
            certificat — inutile qu&apos;ils soient dans l&apos;inventaire des machines.
          </p>
          <div className="flex gap-2">
            <input
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="homelab.abhd.fr"
              className="flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
            />
            <button
              onClick={add}
              disabled={adding}
              className="rounded border border-neutral-600 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
            >
              Ajouter
            </button>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <ul className="space-y-1">
            {domains?.map((d) => (
              <li key={d.id} className="flex items-center justify-between rounded border border-neutral-800 px-2 py-1 text-sm">
                <span className="font-mono text-neutral-300">
                  {d.domain}:{d.port}
                </span>
                <button onClick={() => remove(d.id)} className="text-xs text-red-400 hover:underline">
                  Retirer
                </button>
              </li>
            ))}
            {domains?.length === 0 && <p className="text-xs text-neutral-600">Aucun domaine surveillé.</p>}
          </ul>
        </div>
      )}
    </div>
  );
}
