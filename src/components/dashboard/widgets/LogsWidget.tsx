"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";

const LiveLogPanel = dynamic(() => import("@/components/LiveLogPanel"), { ssr: false });

type DockerHost = { id: number; name: string };
type Container = { id: string; name: string; hostId: number };

type LogCategory = "web-access" | "web-error" | "mail";
type LogSource = {
  id: string;
  hostId: number;
  hostName: string;
  containerId: string;
  containerName: string;
  filePath: string | null;
  label: string;
  category: LogCategory;
};

const CATEGORY_LABELS: Record<LogCategory, string> = {
  "web-access": "Logs web — accès",
  "web-error": "Logs web — erreurs",
  mail: "Logs mail (envoi/réception)",
};

export function LogsWidget() {
  const [sources, setSources] = useState<LogSource[]>([]);
  const [dockerHosts, setDockerHosts] = useState<DockerHost[]>([]);
  const [containers, setContainers] = useState<Container[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formHostId, setFormHostId] = useState<number | null>(null);
  const [formContainerId, setFormContainerId] = useState("");
  const [formFilePath, setFormFilePath] = useState("");
  const [formLabel, setFormLabel] = useState("");
  const [formCategory, setFormCategory] = useState<LogCategory>("web-access");
  const [error, setError] = useState("");

  const loadSources = useCallback(() => {
    fetch("/api/logs/sources")
      .then((r) => r.json())
      .then((d) => setSources(d.sources ?? []));
  }, []);

  useEffect(() => {
    loadSources();
    fetch("/api/docker/containers")
      .then((r) => r.json())
      .then((d) => {
        setDockerHosts((d.hosts ?? []).map((h: { hostId: number; hostName: string }) => ({ id: h.hostId, name: h.hostName })));
        setContainers(d.containers ?? []);
      });
  }, [loadSources]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!formHostId || !formContainerId) return;
    setError("");
    const container = containers.find((c) => c.id === formContainerId);
    const host = dockerHosts.find((h) => h.id === formHostId);
    try {
      const res = await fetch("/api/logs/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostId: formHostId,
          hostName: host?.name ?? "",
          containerId: formContainerId,
          containerName: container?.name ?? "",
          filePath: formFilePath || null,
          label: formLabel || container?.name || "Log",
          category: formCategory,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowForm(false);
      setFormFilePath("");
      setFormLabel("");
      loadSources();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function deleteSource(id: string) {
    await fetch(`/api/logs/sources/${id}`, { method: "DELETE" });
    loadSources();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <button onClick={() => setShowForm((s) => !s)} className="text-xs text-blue-600 hover:underline">
          + Ajouter une source
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="space-y-3 rounded border border-neutral-800 p-4">
          <p className="text-xs text-neutral-400">
            Pointe vers le conteneur qui produit ces logs (ex: Nginx Proxy Manager pour le web,
            Postfix/Dovecot pour le mail). Laisse le chemin de fichier vide pour lire la sortie du
            conteneur (docker logs), ou précise un fichier pour le lire directement dedans.
          </p>
          <div>
            <label className="mb-1 block text-xs">Machine</label>
            <select
              value={formHostId ?? ""}
              onChange={(e) => setFormHostId(Number(e.target.value))}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              required
            >
              <option value="">Choisir...</option>
              {dockerHosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs">Conteneur</label>
            <select
              value={formContainerId}
              onChange={(e) => setFormContainerId(e.target.value)}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              required
            >
              <option value="">Choisir...</option>
              {containers
                .filter((c) => c.hostId === formHostId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs">Catégorie</label>
            <select
              value={formCategory}
              onChange={(e) => setFormCategory(e.target.value as LogCategory)}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
            >
              <option value="web-access">Logs web — accès</option>
              <option value="web-error">Logs web — erreurs</option>
              <option value="mail">Logs mail</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs">Fichier dans le conteneur (optionnel — vide = docker logs)</label>
            <input
              value={formFilePath}
              onChange={(e) => setFormFilePath(e.target.value)}
              placeholder="/data/logs/proxy-host-1_access.log"
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm font-mono"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs">Libellé</label>
            <input
              value={formLabel}
              onChange={(e) => setFormLabel(e.target.value)}
              placeholder="Ex: NPM - accès"
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500">
            Ajouter
          </button>
        </form>
      )}

      {(["web-access", "web-error", "mail"] as LogCategory[]).map((cat) => {
        const items = sources.filter((s) => s.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat} className="space-y-2">
            <div className="text-xs font-medium text-neutral-500">{CATEGORY_LABELS[cat]}</div>
            {items.map((s) => (
              <div key={s.id} className="rounded border border-neutral-800">
                <div className="flex items-center justify-between px-3 py-1.5 text-xs">
                  <span>
                    {s.label} <span className="text-neutral-500">({s.hostName})</span>
                  </span>
                  <button onClick={() => deleteSource(s.id)} className="text-red-400 hover:underline">
                    suppr.
                  </button>
                </div>
                <LiveLogPanel sourceId={s.id} />
              </div>
            ))}
          </div>
        );
      })}

      {sources.length === 0 && !showForm && (
        <p className="text-sm text-neutral-500">
          Aucune source de logs configurée. Ajoute le conteneur Nginx Proxy Manager ou Mailcow pour
          voir les accès, erreurs et l&apos;activité mail ici.
        </p>
      )}
    </div>
  );
}
