"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";

const Terminal = dynamic(() => import("@/components/Terminal"), { ssr: false });

type Container = {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  createdAt: string;
  hostId: number;
  hostName: string;
};

type HostStatus = { hostId: number; hostName: string; error: string | null };

export default function DockerPage() {
  const [containers, setContainers] = useState<Container[]>([]);
  const [hostStatuses, setHostStatuses] = useState<HostStatus[]>([]);
  const [hostFilter, setHostFilter] = useState<number | "all">("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [logsFor, setLogsFor] = useState<Container | null>(null);
  const [logs, setLogs] = useState("");
  const [recreateLog, setRecreateLog] = useState<string[] | null>(null);
  const [terminalFor, setTerminalFor] = useState<Container | null>(null);
  const [showRunForm, setShowRunForm] = useState(false);
  const [runHostId, setRunHostId] = useState<number | null>(null);
  const [runImage, setRunImage] = useState("");
  const [runName, setRunName] = useState("");
  const [runPorts, setRunPorts] = useState("");
  const [runVolumes, setRunVolumes] = useState("");
  const [runEnv, setRunEnv] = useState("");
  const [runRestart, setRunRestart] = useState("unless-stopped");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/docker/containers");
      const data = await res.json();
      setContainers(data.containers);
      setHostStatuses(data.hosts);
      if (runHostId === null && data.hosts.length > 0) setRunHostId(data.hosts[0].hostId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runAction(c: Container, action: "start" | "stop" | "restart" | "remove") {
    if (action === "remove" && !confirm(`Supprimer le conteneur ${c.name} sur ${c.hostName} ?`)) return;
    setPending(`${c.id}-${action}`);
    try {
      const res = await fetch(`/api/docker/${c.hostId}/containers/${c.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setPending(null);
    }
  }

  async function viewLogs(c: Container) {
    setLogsFor(c);
    setLogs("Chargement...");
    try {
      const res = await fetch(`/api/docker/${c.hostId}/containers/${c.id}/logs?tail=300`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setLogs(data.logs || "(vide)");
    } catch (err) {
      setLogs(`Erreur: ${err instanceof Error ? err.message : "inconnue"}`);
    }
  }

  async function recreate(c: Container) {
    if (!confirm(`Mettre à jour l'image et recréer ${c.name} sur ${c.hostName} ?`)) return;
    setPending(`${c.id}-recreate`);
    setRecreateLog(["Démarrage..."]);
    try {
      const res = await fetch(`/api/docker/${c.hostId}/containers/${c.id}/recreate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRecreateLog(data.log);
      load();
    } catch (err) {
      setRecreateLog((l) => [...(l ?? []), `Erreur: ${err instanceof Error ? err.message : "inconnue"}`]);
    } finally {
      setPending(null);
    }
  }

  async function submitRun(e: React.FormEvent) {
    e.preventDefault();
    if (!runHostId) return;
    setError("");
    try {
      const res = await fetch(`/api/docker/${runHostId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: runImage,
          name: runName,
          ports: runPorts.split("\n"),
          volumes: runVolumes.split("\n"),
          env: runEnv.split("\n"),
          restartPolicy: runRestart,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowRunForm(false);
      setRunImage("");
      setRunName("");
      setRunPorts("");
      setRunVolumes("");
      setRunEnv("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  const visibleContainers = containers.filter((c) => hostFilter === "all" || c.hostId === hostFilter);
  const erroredHosts = hostStatuses.filter((h) => h.error);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Docker</h1>
          <p className="text-sm text-neutral-400">
            Vue globale — {containers.length} conteneur{containers.length > 1 ? "s" : ""} sur{" "}
            {hostStatuses.length} machine{hostStatuses.length > 1 ? "s" : ""}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={hostFilter}
            onChange={(e) => setHostFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          >
            <option value="all">Toutes les machines</option>
            {hostStatuses.map((h) => (
              <option key={h.hostId} value={h.hostId}>
                {h.hostName}
              </option>
            ))}
          </select>
          <button
            onClick={() => setShowRunForm((s) => !s)}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500"
          >
            + Lancer un conteneur
          </button>
          <Link
            href="/inventory"
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800"
          >
            Gérer les machines
          </Link>
        </div>
      </div>

      {showRunForm && (
        <form onSubmit={submitRun} className="max-w-lg space-y-3 rounded border border-neutral-800 p-4">
          <div>
            <label className="block text-xs mb-1">Machine</label>
            <select
              value={runHostId ?? ""}
              onChange={(e) => setRunHostId(Number(e.target.value))}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
            >
              {hostStatuses.map((h) => (
                <option key={h.hostId} value={h.hostId}>
                  {h.hostName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1">Image</label>
            <input
              value={runImage}
              onChange={(e) => setRunImage(e.target.value)}
              placeholder="nginx:latest"
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-xs mb-1">Nom (optionnel)</label>
            <input
              value={runName}
              onChange={(e) => setRunName(e.target.value)}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs mb-1">Ports (un par ligne, hôte:conteneur)</label>
            <textarea
              value={runPorts}
              onChange={(e) => setRunPorts(e.target.value)}
              placeholder="8080:80"
              rows={2}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs mb-1">Volumes (un par ligne, hôte:conteneur)</label>
            <textarea
              value={runVolumes}
              onChange={(e) => setRunVolumes(e.target.value)}
              placeholder="/data:/data"
              rows={2}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs mb-1">Variables d&apos;environnement (une par ligne)</label>
            <textarea
              value={runEnv}
              onChange={(e) => setRunEnv(e.target.value)}
              placeholder="KEY=VALUE"
              rows={2}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs mb-1">Politique de redémarrage</label>
            <select
              value={runRestart}
              onChange={(e) => setRunRestart(e.target.value)}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
            >
              <option value="unless-stopped">unless-stopped</option>
              <option value="always">always</option>
              <option value="on-failure">on-failure</option>
              <option value="no">no</option>
            </select>
          </div>
          <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500">
            Lancer
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-neutral-500">Chargement...</p>}
      {erroredHosts.map((h) => (
        <p key={h.hostId} className="text-xs text-amber-400">
          {h.hostName}: {h.error}
        </p>
      ))}

      {visibleContainers.length > 0 && (
        <div className="overflow-auto rounded border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-left text-neutral-400">
              <tr>
                <th className="px-3 py-2 font-medium">Nom</th>
                <th className="px-3 py-2 font-medium">Machine</th>
                <th className="px-3 py-2 font-medium">Image</th>
                <th className="px-3 py-2 font-medium">Statut</th>
                <th className="px-3 py-2 font-medium">Ports</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleContainers.map((c) => (
                <tr key={`${c.hostId}-${c.id}`} className="border-t border-neutral-800">
                  <td className="px-3 py-2 font-medium">{c.name}</td>
                  <td className="px-3 py-2 text-neutral-400">{c.hostName}</td>
                  <td className="px-3 py-2 font-mono text-xs text-neutral-400">{c.image}</td>
                  <td className="px-3 py-2">
                    <span className={c.state === "running" ? "text-green-400" : "text-neutral-500"}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-400">{c.ports || "—"}</td>
                  <td className="px-3 py-2 space-x-1.5">
                    {c.state === "running" ? (
                      <>
                        <button
                          onClick={() => runAction(c, "stop")}
                          disabled={pending === `${c.id}-stop`}
                          className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800"
                        >
                          Stop
                        </button>
                        <button
                          onClick={() => runAction(c, "restart")}
                          disabled={pending === `${c.id}-restart`}
                          className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800"
                        >
                          Restart
                        </button>
                        <button
                          onClick={() => setTerminalFor(c)}
                          className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800"
                        >
                          Terminal
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => runAction(c, "start")}
                        disabled={pending === `${c.id}-start`}
                        className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800"
                      >
                        Start
                      </button>
                    )}
                    <button
                      onClick={() => recreate(c)}
                      disabled={pending === `${c.id}-recreate`}
                      className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800"
                    >
                      Update image
                    </button>
                    <button
                      onClick={() => viewLogs(c)}
                      className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800"
                    >
                      Logs
                    </button>
                    <button
                      onClick={() => runAction(c, "remove")}
                      className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-red-400 hover:bg-neutral-800"
                    >
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {logsFor && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-8">
          <div className="flex h-full w-full max-w-3xl flex-col rounded border border-neutral-700 bg-neutral-950 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">
                Logs — {logsFor.name} ({logsFor.hostName})
              </span>
              <button
                onClick={() => setLogsFor(null)}
                className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
              >
                Fermer
              </button>
            </div>
            <pre className="flex-1 overflow-auto rounded border border-neutral-800 bg-black p-3 font-mono text-xs text-neutral-300">
              {logs}
            </pre>
          </div>
        </div>
      )}

      {terminalFor && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-8">
          <div className="flex h-full w-full max-w-3xl flex-col rounded border border-neutral-700 bg-neutral-950 p-2">
            <div className="mb-2 flex items-center justify-between px-2">
              <span className="text-sm font-medium">
                Terminal — {terminalFor.name} ({terminalFor.hostName})
              </span>
              <button
                onClick={() => setTerminalFor(null)}
                className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
              >
                Fermer
              </button>
            </div>
            <div className="flex-1 rounded border border-neutral-800 bg-black p-2">
              <Terminal hostId={terminalFor.hostId} containerId={terminalFor.id} />
            </div>
          </div>
        </div>
      )}

      {recreateLog && (
        <div className="fixed bottom-4 right-4 max-w-md rounded border border-neutral-700 bg-neutral-900 p-3 text-xs">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium">Recréation</span>
            <button onClick={() => setRecreateLog(null)} className="text-neutral-500 hover:text-neutral-300">
              ✕
            </button>
          </div>
          {recreateLog.map((l, i) => (
            <div key={i} className="text-neutral-400">
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
