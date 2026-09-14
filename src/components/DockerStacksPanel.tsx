"use client";

import { useEffect, useState } from "react";

type Host = { id: number; name: string; docker_enabled: number };
type Stack = { id: string; hostId: number; name: string; composeContent: string; updatedAt: string };

const EXAMPLE_COMPOSE = `services:
  app:
    image: nginx:latest
    restart: unless-stopped
    ports:
      - "8080:80"
`;

export default function DockerStacksPanel() {
  const [dockerHosts, setDockerHosts] = useState<Host[]>([]);
  const [stacks, setStacks] = useState<Stack[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [hostId, setHostId] = useState<number | null>(null);
  const [compose, setCompose] = useState(EXAMPLE_COMPOSE);
  const [deploying, setDeploying] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [log, setLog] = useState("");
  const [error, setError] = useState("");

  function loadStacks(forHosts: Host[]) {
    Promise.all(forHosts.map((h) => fetch(`/api/docker/${h.id}/stacks`).then((r) => r.json())))
      .then((results) => setStacks(results.flatMap((r) => r.stacks || [])));
  }

  useEffect(() => {
    fetch("/api/hosts")
      .then((r) => r.json())
      .then((d) => {
        const withDocker = (d.hosts as Host[]).filter((h) => h.docker_enabled);
        setDockerHosts(withDocker);
        setHostId((current) => current ?? withDocker[0]?.id ?? null);
        if (withDocker.length > 0) loadStacks(withDocker);
      });
  }, []);

  async function deploy() {
    if (!hostId || !name.trim() || !compose.trim()) return;
    setDeploying(true);
    setError("");
    setLog("");
    try {
      const res = await fetch(`/api/docker/${hostId}/stacks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, composeContent: compose }),
      });
      const data = await res.json();
      setLog(data.log || "");
      if (!res.ok) throw new Error(data.error);
      setName("");
      setCompose(EXAMPLE_COMPOSE);
      setShowForm(false);
      loadStacks(dockerHosts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setDeploying(false);
    }
  }

  async function action(stack: Stack, kind: "redeploy" | "down" | "delete") {
    setBusyId(stack.id);
    setError("");
    try {
      if (kind === "delete") {
        if (!confirm(`Supprimer la stack "${stack.name}" (arrête et retire ses conteneurs) ?`)) return;
        await fetch(`/api/docker/${stack.hostId}/stacks/${stack.id}`, { method: "DELETE" });
      } else {
        const res = await fetch(`/api/docker/${stack.hostId}/stacks/${stack.id}/${kind}`, { method: "POST" });
        const data = await res.json();
        setLog(data.log || "");
        if (!res.ok) throw new Error(data.error);
      }
      loadStacks(dockerHosts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setBusyId(null);
    }
  }

  if (dockerHosts.length === 0) return null;

  return (
    <section className="space-y-3 rounded border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-neutral-100">Stacks (docker-compose)</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Colle n&apos;importe quel fichier docker-compose.yml et déploie-le sur la machine de ton choix, sans être
            limité aux modèles prédéfinis.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-xs text-blue-200 hover:bg-blue-900/60"
        >
          {showForm ? "Annuler" : "+ Nouvelle stack"}
        </button>
      </div>

      {showForm && (
        <div className="space-y-2 rounded border border-neutral-800 p-3">
          <div className="grid grid-cols-2 gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nom de la stack"
              className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
            />
            <select
              value={hostId ?? ""}
              onChange={(e) => setHostId(Number(e.target.value))}
              className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
            >
              {dockerHosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>
          <textarea
            value={compose}
            onChange={(e) => setCompose(e.target.value)}
            rows={10}
            spellCheck={false}
            className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 font-mono text-xs text-neutral-100"
          />
          <button
            onClick={deploy}
            disabled={deploying}
            className="rounded border border-emerald-700 bg-emerald-900/40 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-900/60 disabled:opacity-50"
          >
            {deploying ? "Déploiement..." : "Déployer"}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {log && <pre className="max-h-40 overflow-y-auto rounded border border-neutral-800 bg-neutral-950 p-2 text-[11px] text-neutral-400">{log}</pre>}

      <div className="space-y-2">
        {stacks.map((s) => (
          <div key={s.id} className="flex items-center justify-between rounded border border-neutral-800 px-3 py-2 text-sm">
            <div>
              <span className="font-medium text-neutral-100">{s.name}</span>
              <span className="ml-2 text-xs text-neutral-500">{dockerHosts.find((h) => h.id === s.hostId)?.name}</span>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => action(s, "redeploy")}
                disabled={busyId === s.id}
                className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800 disabled:opacity-50"
              >
                Redéployer
              </button>
              <button
                onClick={() => action(s, "down")}
                disabled={busyId === s.id}
                className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800 disabled:opacity-50"
              >
                Arrêter
              </button>
              <button
                onClick={() => action(s, "delete")}
                disabled={busyId === s.id}
                className="rounded border border-red-900 px-2 py-0.5 text-xs text-red-300 hover:bg-red-950/40 disabled:opacity-50"
              >
                Supprimer
              </button>
            </div>
          </div>
        ))}
        {stacks.length === 0 && <p className="text-sm text-neutral-600">Aucune stack déployée pour l&apos;instant.</p>}
      </div>
    </section>
  );
}
