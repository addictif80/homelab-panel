"use client";

import { useEffect, useState } from "react";

type Host = { id: number; name: string };
type Source = {
  id: string;
  hostId: number;
  sourceType: "file" | "docker";
  sourcePath: string;
  enabled: boolean;
  lastError: string | null;
};

export default function MailLogSourcesPanel() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [hostId, setHostId] = useState<number | "">("");
  const [sourceType, setSourceType] = useState<"file" | "docker">("file");
  const [sourcePath, setSourcePath] = useState("");
  const [saving, setSaving] = useState(false);
  const [scanningAll, setScanningAll] = useState(false);
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<Record<string, string>>({});

  async function load() {
    const [hostsRes, sourcesRes] = await Promise.all([fetch("/api/hosts"), fetch("/api/settings/mail-sources")]);
    const hostsData = await hostsRes.json();
    const sourcesData = await sourcesRes.json();
    setHosts(hostsData.hosts ?? hostsData ?? []);
    setSources(sourcesData.sources ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function addSource() {
    if (!hostId || !sourcePath.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/settings/mail-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostId, sourceType, sourcePath }),
      });
      setSourcePath("");
      load();
    } finally {
      setSaving(false);
    }
  }

  async function toggle(id: string, enabled: boolean) {
    await fetch(`/api/settings/mail-sources/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    load();
  }

  async function remove(id: string) {
    if (!confirm("Supprimer cette source ?")) return;
    await fetch(`/api/settings/mail-sources/${id}`, { method: "DELETE" });
    load();
  }

  async function scanOne(id: string) {
    setScanningId(id);
    try {
      const res = await fetch(`/api/settings/mail-sources/${id}/poll`, { method: "POST" });
      const data = await res.json();
      setScanResult((prev) => ({
        ...prev,
        [id]: data.lastError ? `Erreur : ${data.lastError}` : `${data.inserted} nouvel${data.inserted === 1 ? "" : "s"} événement${data.inserted === 1 ? "" : "s"} trouvé${data.inserted === 1 ? "" : "s"}.`,
      }));
      load();
    } finally {
      setScanningId(null);
    }
  }

  async function scanAll() {
    setScanningAll(true);
    try {
      await fetch("/api/settings/mail-sources/poll-all", { method: "POST" });
      load();
    } finally {
      setScanningAll(false);
    }
  }

  function hostName(id: number) {
    return hosts.find((h) => h.id === id)?.name ?? `#${id}`;
  }

  return (
    <section className="space-y-3 rounded border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-100">Anti-spam mail</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Sources d&apos;où lire l&apos;activité mail entrante pour le tableau de bord Anti-spam. Fichier de log
            (Postfix natif, ex: /var/log/mail.log) ou logs d&apos;un conteneur Docker (stack mail dockerisée comme
            Mailcow) — l&apos;analyse reconnaît les formats Postfix et rspamd, très répandus dans les serveurs mail
            auto-hébergés. Lues automatiquement toutes les 2 minutes, ou à la demande ci-dessous.
          </p>
        </div>
        <button
          onClick={scanAll}
          disabled={scanningAll || sources.length === 0}
          className="shrink-0 rounded border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
        >
          {scanningAll ? "Scan en cours..." : "Scanner tout maintenant"}
        </button>
      </div>

      <div className="divide-y divide-neutral-800 rounded border border-neutral-800">
        {sources.map((s) => (
          <div key={s.id} className="flex items-center gap-3 p-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate text-neutral-100">
                {hostName(s.hostId)} <span className="text-neutral-500">— {s.sourceType === "file" ? "fichier" : "conteneur Docker"}</span>
              </p>
              <p className="truncate font-mono text-xs text-neutral-500">{s.sourcePath}</p>
              {s.lastError && <p className="truncate text-xs text-red-400" title={s.lastError}>⚠ {s.lastError}</p>}
              {scanResult[s.id] && <p className="truncate text-xs text-neutral-500">{scanResult[s.id]}</p>}
            </div>
            <button
              onClick={() => scanOne(s.id)}
              disabled={scanningId === s.id}
              className="shrink-0 rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
            >
              {scanningId === s.id ? "Scan..." : "Scanner maintenant"}
            </button>
            <label className="flex shrink-0 items-center gap-1.5 text-xs text-neutral-400">
              <input type="checkbox" checked={s.enabled} onChange={(e) => toggle(s.id, e.target.checked)} />
              Actif
            </label>
            <button
              onClick={() => remove(s.id)}
              className="shrink-0 rounded border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40"
            >
              Supprimer
            </button>
          </div>
        ))}
        {sources.length === 0 && (
          <p className="p-4 text-center text-sm text-neutral-600">Aucune source configurée.</p>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2 border-t border-neutral-800 pt-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-neutral-500">Machine</label>
          <select
            value={hostId}
            onChange={(e) => setHostId(e.target.value ? Number(e.target.value) : "")}
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
          >
            <option value="">Sélectionner...</option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-neutral-500">Type</label>
          <select
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as "file" | "docker")}
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
          >
            <option value="file">Fichier de log</option>
            <option value="docker">Conteneur Docker</option>
          </select>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label className="text-xs text-neutral-500">
            {sourceType === "file" ? "Chemin du fichier" : "Nom du conteneur"}
          </label>
          <input
            value={sourcePath}
            onChange={(e) => setSourcePath(e.target.value)}
            placeholder={sourceType === "file" ? "/var/log/mail.log" : "mailcow-postfix-mailcow-1"}
            className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600"
          />
        </div>
        <button
          onClick={addSource}
          disabled={saving || !hostId || !sourcePath.trim()}
          className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-900/60 disabled:opacity-50"
        >
          Ajouter
        </button>
      </div>
    </section>
  );
}
