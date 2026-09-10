"use client";

import { useCallback, useEffect, useState } from "react";

type Host = { id: number; name: string; update_method: string | null };
type Plan = {
  id: string;
  name: string;
  hostIds: number[];
  mode: "dry-run" | "apply";
  allowAutoReboot: boolean;
  delaySeconds: number;
};
type Run = {
  id: string;
  planId: string;
  status: "running" | "success" | "failed";
  currentIndex: number;
  jobIds: string[];
};

export default function MaintenancePlansPanel() {
  const [open, setOpen] = useState(false);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [runs, setRuns] = useState<Record<string, Run | null>>({});
  const [error, setError] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [selectedHosts, setSelectedHosts] = useState<number[]>([]);
  const [mode, setMode] = useState<"dry-run" | "apply">("dry-run");
  const [allowAutoReboot, setAllowAutoReboot] = useState(false);
  const [delaySeconds, setDelaySeconds] = useState(120);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [hostsRes, plansRes] = await Promise.all([fetch("/api/hosts"), fetch("/api/maintenance/plans")]);
    const hostsData = await hostsRes.json();
    const plansData = await plansRes.json();
    setHosts(hostsData.hosts.filter((h: Host) => h.update_method));
    setPlans(plansData.plans);
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  function toggleHost(id: number) {
    setSelectedHosts((s) => (s.includes(id) ? s.filter((h) => h !== id) : [...s, id]));
  }

  function moveHost(id: number, dir: -1 | 1) {
    setSelectedHosts((s) => {
      const i = s.indexOf(id);
      const j = i + dir;
      if (j < 0 || j >= s.length) return s;
      const copy = [...s];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }

  async function createPlan(e: React.FormEvent) {
    e.preventDefault();
    if (selectedHosts.length === 0) {
      setError("Sélectionne au moins une machine.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/maintenance/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, hostIds: selectedHosts, mode, allowAutoReboot, delaySeconds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowCreate(false);
      setName("");
      setSelectedHosts([]);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setSaving(false);
    }
  }

  async function deletePlan(id: string) {
    if (!confirm("Supprimer ce plan de maintenance ?")) return;
    await fetch(`/api/maintenance/plans/${id}`, { method: "DELETE" });
    load();
  }

  function pollRun(planId: string, runId: string) {
    const tick = async () => {
      const res = await fetch(`/api/maintenance/runs/${runId}`);
      const data = await res.json();
      if (!res.ok) return;
      setRuns((r) => ({ ...r, [planId]: data.run }));
      if (data.run.status === "running") setTimeout(tick, 3000);
    };
    tick();
  }

  async function runPlan(plan: Plan) {
    if (!confirm(`Lancer la fenêtre de maintenance « ${plan.name} » (${plan.hostIds.length} machines) ?`)) return;
    setError("");
    try {
      const res = await fetch(`/api/maintenance/plans/${plan.id}/run`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      pollRun(plan.id, data.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    }
  }

  function hostName(id: number): string {
    return hosts.find((h) => h.id === id)?.name ?? `#${id}`;
  }

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-neutral-300"
      >
        <span>Fenêtres de maintenance (mises à jour échelonnées multi-machines)</span>
        <span className="text-neutral-500">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-neutral-800 p-4">
          <p className="text-xs text-neutral-500">
            Enchaîne les mises à jour sur plusieurs machines dans un ordre choisi, avec un délai entre chacune — utile
            pour laisser un routeur ou un NAS finir de redémarrer avant de toucher aux machines qui en dépendent.
          </p>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            onClick={() => setShowCreate((s) => !s)}
            className="rounded border border-neutral-600 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
          >
            {showCreate ? "Annuler" : "+ Nouveau plan"}
          </button>

          {showCreate && (
            <form onSubmit={createPlan} className="space-y-3 rounded border border-neutral-800 p-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nom du plan (ex: Maintenance mensuelle)"
                required
                className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm"
              />
              <div>
                <p className="mb-1 text-xs text-neutral-400">
                  Machines (clique pour ajouter/retirer, réordonne avec les flèches — l&apos;ordre est celui
                  d&apos;exécution)
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {hosts.map((h) => (
                    <button
                      type="button"
                      key={h.id}
                      onClick={() => toggleHost(h.id)}
                      className={`rounded border px-2 py-1 text-xs ${
                        selectedHosts.includes(h.id)
                          ? "border-blue-600 bg-blue-900/30 text-blue-200"
                          : "border-neutral-700 text-neutral-400 hover:bg-neutral-800"
                      }`}
                    >
                      {h.name}
                    </button>
                  ))}
                </div>
                {selectedHosts.length > 0 && (
                  <ol className="mt-2 space-y-1">
                    {selectedHosts.map((id, i) => (
                      <li key={id} className="flex items-center gap-2 text-xs text-neutral-300">
                        <span className="text-neutral-500">{i + 1}.</span>
                        {hostName(id)}
                        <button type="button" onClick={() => moveHost(id, -1)} className="text-neutral-500 hover:text-neutral-200">
                          ▲
                        </button>
                        <button type="button" onClick={() => moveHost(id, 1)} className="text-neutral-500 hover:text-neutral-200">
                          ▼
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs text-neutral-400">Mode</span>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as "dry-run" | "apply")}
                    className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm"
                  >
                    <option value="dry-run">Simulation (dry-run)</option>
                    <option value="apply">Application réelle</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-neutral-400">Délai entre machines (secondes)</span>
                  <input
                    type="number"
                    min={0}
                    value={delaySeconds}
                    onChange={(e) => setDelaySeconds(Number(e.target.value))}
                    className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm"
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-xs text-neutral-400">
                <input type="checkbox" checked={allowAutoReboot} onChange={(e) => setAllowAutoReboot(e.target.checked)} />
                Autoriser le redémarrage automatique si nécessaire (apt uniquement)
              </label>
              <button
                type="submit"
                disabled={saving}
                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium hover:bg-blue-500 disabled:opacity-50"
              >
                {saving ? "Enregistrement..." : "Créer le plan"}
              </button>
            </form>
          )}

          <ul className="space-y-2">
            {plans.map((p) => {
              const run = runs[p.id];
              return (
                <li key={p.id} className="rounded border border-neutral-800 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-neutral-200">{p.name}</p>
                      <p className="text-xs text-neutral-500">
                        {p.hostIds.map(hostName).join(" → ")} · {p.mode === "apply" ? "application" : "simulation"} ·{" "}
                        {p.delaySeconds}s entre machines
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => runPlan(p)}
                        disabled={run?.status === "running"}
                        className="rounded border border-neutral-600 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                      >
                        {run?.status === "running" ? "En cours..." : "Lancer"}
                      </button>
                      <button
                        onClick={() => deletePlan(p.id)}
                        className="rounded border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40"
                      >
                        Supprimer
                      </button>
                    </div>
                  </div>
                  {run && (
                    <p className="mt-2 text-xs text-neutral-400">
                      Étape {Math.min(run.currentIndex + 1, p.hostIds.length)}/{p.hostIds.length} —{" "}
                      <span
                        className={
                          run.status === "success"
                            ? "text-emerald-400"
                            : run.status === "failed"
                              ? "text-red-400"
                              : "text-amber-400"
                        }
                      >
                        {run.status === "running" ? "en cours" : run.status === "success" ? "terminé" : "échec"}
                      </span>
                    </p>
                  )}
                </li>
              );
            })}
            {plans.length === 0 && <p className="text-xs text-neutral-600">Aucun plan de maintenance.</p>}
          </ul>
        </div>
      )}
    </div>
  );
}
