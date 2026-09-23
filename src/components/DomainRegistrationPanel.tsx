"use client";

import { useEffect, useState } from "react";

type Domain = { id: string; domain: string };
type Status = {
  id: string;
  domain: string;
  registrar: string | null;
  registeredAt: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  error: string | null;
};

function daysColor(days: number | null): string {
  if (days === null) return "text-neutral-500";
  if (days < 14) return "text-red-400";
  if (days < 45) return "text-amber-400";
  return "text-emerald-400";
}

export default function DomainRegistrationPanel({ onChanged }: { onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const [domains, setDomains] = useState<Domain[] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [checking, setChecking] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/settings/domains")
      .then((r) => r.json())
      .then((d) => setDomains(d.domains));
  }

  async function checkStatuses() {
    setChecking(true);
    try {
      const res = await fetch("/api/settings/domains/status");
      const data = await res.json();
      const map: Record<string, Status> = {};
      for (const s of data.statuses as Status[]) map[s.id] = s;
      setStatuses(map);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (open && !domains) load();
  }, [open, domains]);

  async function add() {
    if (!newDomain.trim()) return;
    setAdding(true);
    setError("");
    try {
      const res = await fetch("/api/settings/domains", {
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
    await fetch(`/api/settings/domains/${id}`, { method: "DELETE" });
    load();
    onChanged?.();
  }

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-neutral-300"
      >
        <span>Noms de domaine surveillés (expiration, registrar)</span>
        <span className="text-neutral-500">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-neutral-800 p-4">
          <p className="text-xs text-neutral-500">
            Interroge le registre public (RDAP) de chaque domaine — pas besoin d&apos;identifiants de registrar,
            fonctionne quel que soit celui chez qui il est enregistré.
          </p>
          <div className="flex gap-2">
            <input
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="exemple.fr"
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

          {domains && domains.length > 0 && (
            <button
              onClick={checkStatuses}
              disabled={checking}
              className="text-xs text-blue-400 hover:underline disabled:opacity-50"
            >
              {checking ? "Vérification..." : "Vérifier maintenant"}
            </button>
          )}

          <ul className="space-y-1">
            {domains?.map((d) => {
              const s = statuses[d.id];
              return (
                <li key={d.id} className="rounded border border-neutral-800 px-2 py-1.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-neutral-300">{d.domain}</span>
                    <button onClick={() => remove(d.id)} className="text-xs text-red-400 hover:underline">
                      Retirer
                    </button>
                  </div>
                  {s && (
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {s.error ? (
                        <span className="text-amber-400">{s.error}</span>
                      ) : (
                        <>
                          {s.registrar ?? "Registrar inconnu"} —{" "}
                          <span className={daysColor(s.daysRemaining)}>
                            {s.daysRemaining !== null ? `expire dans ${s.daysRemaining} j` : "date inconnue"}
                          </span>
                        </>
                      )}
                    </p>
                  )}
                </li>
              );
            })}
            {domains?.length === 0 && <p className="text-xs text-neutral-600">Aucun domaine surveillé.</p>}
          </ul>
        </div>
      )}
    </div>
  );
}
