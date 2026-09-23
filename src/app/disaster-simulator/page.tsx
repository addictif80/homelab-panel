"use client";

import { useEffect, useState } from "react";

type Host = { id: number; name: string; kind: string };
type Step = { id: string; title: string; status: "ok" | "warning" | "critical"; detail: string };

const STATUS_STYLES: Record<Step["status"], { dot: string; border: string }> = {
  ok: { dot: "bg-emerald-500", border: "border-emerald-900" },
  warning: { dot: "bg-amber-500", border: "border-amber-900" },
  critical: { dot: "bg-red-500", border: "border-red-900" },
};

export default function DisasterSimulatorPage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [hostId, setHostId] = useState<number | "">("");
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/hosts")
      .then((r) => r.json())
      .then((d) => setHosts(d.hosts ?? []));
  }, []);

  async function run() {
    if (!hostId) return;
    setLoading(true);
    setError("");
    setSteps(null);
    try {
      const res = await fetch(`/api/disaster-simulator?hostId=${hostId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSteps(data.steps);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Simulateur de sinistre</h1>
        <p className="text-sm text-neutral-400">
          Choisis une machine et simule sa panne totale, maintenant — le panel déroule, étape par étape, ce qui
          casserait réellement (dépendances, sauvegardes disponibles) d&apos;après les données actuelles.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-neutral-500">Machine à faire tomber</label>
          <select
            value={hostId}
            onChange={(e) => setHostId(e.target.value ? Number(e.target.value) : "")}
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
          >
            <option value="">Choisir...</option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={run}
          disabled={!hostId || loading}
          className="rounded border border-red-800 bg-red-950/40 px-3 py-1.5 text-sm text-red-200 hover:bg-red-950/60 disabled:opacity-50"
        >
          {loading ? "Simulation..." : "Simuler la panne"}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {steps && (
        <div className="space-y-2">
          {steps.map((step, idx) => {
            const style = STATUS_STYLES[step.status];
            return (
              <div key={step.id} className={`rounded border ${style.border} bg-neutral-900 p-4`}>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-600">Étape {idx + 1}</span>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
                  <h3 className="text-sm font-semibold text-neutral-100">{step.title}</h3>
                </div>
                <p className="mt-1.5 text-sm text-neutral-400">{step.detail}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
