"use client";

import { useCallback, useEffect, useState } from "react";

const MODULES = [
  { name: "Serveurs physiques", href: "/servers" },
  { name: "Serveurs VM", href: "/proxmox" },
  { name: "Docker", href: "/docker" },
  { name: "Terminal SSH", href: "/ssh" },
  { name: "Mises à jour", href: "/updates" },
  { name: "Explorateur de fichiers", href: "/files" },
  { name: "Tailscale", href: "/tailscale" },
  { name: "Inventaire & topologie", href: "/inventory" },
];

type HostStats = {
  hostId: number;
  hostName: string;
  cores: number | null;
  cpuUsedPercent: number | null;
  memTotalMb: number | null;
  memUsedMb: number | null;
  diskTotalGb: number | null;
  diskUsedGb: number | null;
  error: string | null;
};

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

function formatGb(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)} Go`;
}

export default function Home() {
  const [stats, setStats] = useState<HostStats[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);

  const [sources, setSources] = useState<LogSource[]>([]);
  const [dockerHosts, setDockerHosts] = useState<DockerHost[]>([]);
  const [containers, setContainers] = useState<Container[]>([]);
  const [showLogForm, setShowLogForm] = useState(false);
  const [formHostId, setFormHostId] = useState<number | null>(null);
  const [formContainerId, setFormContainerId] = useState("");
  const [formFilePath, setFormFilePath] = useState("");
  const [formLabel, setFormLabel] = useState("");
  const [formCategory, setFormCategory] = useState<LogCategory>("web-access");
  const [logError, setLogError] = useState("");

  const [viewing, setViewing] = useState<LogSource | null>(null);
  const [viewLines, setViewLines] = useState("");

  useEffect(() => {
    fetch("/api/monitoring/stats")
      .then((r) => r.json())
      .then((d) => setStats(d.hosts))
      .finally(() => setStatsLoading(false));
  }, []);

  const loadSources = useCallback(() => {
    fetch("/api/logs/sources")
      .then((r) => r.json())
      .then((d) => setSources(d.sources));
  }, []);

  useEffect(() => {
    loadSources();
    fetch("/api/docker/containers")
      .then((r) => r.json())
      .then((d) => {
        setDockerHosts(d.hosts.map((h: { hostId: number; hostName: string }) => ({ id: h.hostId, name: h.hostName })));
        setContainers(d.containers);
      });
  }, [loadSources]);

  async function submitLogSource(e: React.FormEvent) {
    e.preventDefault();
    if (!formHostId || !formContainerId) return;
    setLogError("");
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
      setShowLogForm(false);
      setFormFilePath("");
      setFormLabel("");
      loadSources();
    } catch (err) {
      setLogError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function deleteSource(id: string) {
    await fetch(`/api/logs/sources/${id}`, { method: "DELETE" });
    loadSources();
  }

  async function viewSource(source: LogSource) {
    setViewing(source);
    setViewLines("Chargement...");
    try {
      const res = await fetch(`/api/logs/sources/${source.id}/tail?tail=300`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setViewLines(data.lines || "(vide)");
    } catch (err) {
      setViewLines(`Erreur: ${err instanceof Error ? err.message : "inconnue"}`);
    }
  }

  const reachable = stats.filter((s) => s.error === null);
  const totals = reachable.reduce(
    (acc, s) => ({
      cores: acc.cores + (s.cores ?? 0),
      memTotal: acc.memTotal + (s.memTotalMb ?? 0) / 1024,
      memUsed: acc.memUsed + (s.memUsedMb ?? 0) / 1024,
      diskTotal: acc.diskTotal + (s.diskTotalGb ?? 0),
      diskUsed: acc.diskUsed + (s.diskUsedGb ?? 0),
      cpuSum: acc.cpuSum + (s.cpuUsedPercent ?? 0),
    }),
    { cores: 0, memTotal: 0, memUsed: 0, diskTotal: 0, diskUsed: 0, cpuSum: 0 }
  );
  const avgCpu = reachable.length > 0 ? totals.cpuSum / reachable.length : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Vue d&apos;ensemble</h1>
        <p className="text-sm text-neutral-400">Panneau de contrôle centralisé du homelab.</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-300">
          Ressources cumulées — serveurs physiques + VPS
        </h2>
        {statsLoading ? (
          <p className="text-sm text-neutral-500">Chargement des statistiques...</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatCard
                label="CPU (moyenne)"
                value={avgCpu === null ? "—" : `${avgCpu.toFixed(0)}%`}
                sub={`${totals.cores} cœurs cumulés`}
              />
              <StatCard
                label="RAM utilisée"
                value={formatGb(totals.memUsed)}
                sub={`sur ${formatGb(totals.memTotal)}`}
              />
              <StatCard
                label="Stockage utilisé"
                value={formatGb(totals.diskUsed)}
                sub={`sur ${formatGb(totals.diskTotal)}`}
              />
              <StatCard
                label="Machines"
                value={`${reachable.length}/${stats.length}`}
                sub="joignables"
              />
            </div>
            {stats.some((s) => s.error) && (
              <div className="space-y-1">
                {stats
                  .filter((s) => s.error)
                  .map((s) => (
                    <p key={s.hostId} className="text-xs text-amber-400">
                      {s.hostName}: {s.error}
                    </p>
                  ))}
              </div>
            )}
            {reachable.length > 0 && (
              <div className="overflow-auto rounded border border-neutral-800">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-900 text-left text-neutral-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">Machine</th>
                      <th className="px-3 py-2 font-medium">CPU</th>
                      <th className="px-3 py-2 font-medium">RAM</th>
                      <th className="px-3 py-2 font-medium">Disque</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reachable.map((s) => (
                      <tr key={s.hostId} className="border-t border-neutral-800">
                        <td className="px-3 py-2 font-medium">{s.hostName}</td>
                        <td className="px-3 py-2 text-neutral-400">
                          {s.cpuUsedPercent === null ? "—" : `${s.cpuUsedPercent.toFixed(0)}%`}
                        </td>
                        <td className="px-3 py-2 text-neutral-400">
                          {formatGb((s.memUsedMb ?? 0) / 1024)} / {formatGb((s.memTotalMb ?? 0) / 1024)}
                        </td>
                        <td className="px-3 py-2 text-neutral-400">
                          {formatGb(s.diskUsedGb)} / {formatGb(s.diskTotalGb)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-300">Logs web & mail</h2>
          <button
            onClick={() => setShowLogForm((s) => !s)}
            className="text-xs text-blue-400 hover:underline"
          >
            + Ajouter une source de logs
          </button>
        </div>

        {showLogForm && (
          <form onSubmit={submitLogSource} className="max-w-lg space-y-3 rounded border border-neutral-800 p-4">
            <p className="text-xs text-neutral-400">
              Pointe vers le conteneur qui produit ces logs (ex: Nginx Proxy Manager pour le web,
              Postfix/Dovecot pour le mail). Laisse le chemin de fichier vide pour lire la sortie
              du conteneur (docker logs), ou précise un fichier (ex: un log d&apos;accès NPM par
              vhost) pour le lire directement dedans.
            </p>
            <div>
              <label className="block text-xs mb-1">Machine</label>
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
              <label className="block text-xs mb-1">Conteneur</label>
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
              <label className="block text-xs mb-1">Catégorie</label>
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
              <label className="block text-xs mb-1">
                Fichier dans le conteneur (optionnel — vide = docker logs)
              </label>
              <input
                value={formFilePath}
                onChange={(e) => setFormFilePath(e.target.value)}
                placeholder="/data/logs/proxy-host-1_access.log"
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs mb-1">Libellé</label>
              <input
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
                placeholder="Ex: NPM - accès"
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              />
            </div>
            {logError && <p className="text-xs text-red-400">{logError}</p>}
            <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500">
              Ajouter
            </button>
          </form>
        )}

        {(["web-access", "web-error", "mail"] as LogCategory[]).map((cat) => {
          const items = sources.filter((s) => s.category === cat);
          if (items.length === 0) return null;
          return (
            <div key={cat} className="space-y-1">
              <div className="text-xs font-medium text-neutral-500">{CATEGORY_LABELS[cat]}</div>
              <div className="flex flex-wrap gap-2">
                {items.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-2 rounded border border-neutral-800 px-3 py-1.5 text-xs"
                  >
                    <span>
                      {s.label} <span className="text-neutral-500">({s.hostName})</span>
                    </span>
                    <button onClick={() => viewSource(s)} className="text-blue-400 hover:underline">
                      Voir
                    </button>
                    <button onClick={() => deleteSource(s.id)} className="text-red-400 hover:underline">
                      suppr.
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {sources.length === 0 && !showLogForm && (
          <p className="text-sm text-neutral-500">
            Aucune source de logs configurée. Ajoute le conteneur Nginx Proxy Manager ou Mailcow
            pour voir les accès, erreurs et l&apos;activité mail ici.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-300">Modules</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {MODULES.map((m) => (
            <a
              key={m.href}
              href={m.href}
              className="rounded border border-neutral-800 bg-neutral-900 p-4 hover:border-neutral-700"
            >
              <div className="text-sm font-medium">{m.name}</div>
            </a>
          ))}
        </div>
      </section>

      {viewing && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-8">
          <div className="flex h-full w-full max-w-3xl flex-col rounded border border-neutral-700 bg-neutral-950 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">
                {viewing.label} — {viewing.hostName}
              </span>
              <div className="space-x-2">
                <button
                  onClick={() => viewSource(viewing)}
                  className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
                >
                  Rafraîchir
                </button>
                <button
                  onClick={() => setViewing(null)}
                  className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
                >
                  Fermer
                </button>
              </div>
            </div>
            <pre className="flex-1 overflow-auto rounded border border-neutral-800 bg-black p-3 font-mono text-xs text-neutral-300">
              {viewLines}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-neutral-500">{sub}</div>
    </div>
  );
}
