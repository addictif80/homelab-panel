"use client";

import { useEffect, useState } from "react";

type Host = { id: number; name: string };
type FileEntry = { name: string; type: "file" | "directory" | "symlink" | "other"; size: number; modifiedAt: number };

function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

export default function CopyToHostModal({
  hosts,
  sourceHostId,
  sourcePath,
  onClose,
  onStarted,
}: {
  hosts: Host[];
  sourceHostId: number;
  sourcePath: string;
  onClose: () => void;
  onStarted: (jobId: string) => void;
}) {
  const [destHostId, setDestHostId] = useState<number>(hosts.find((h) => h.id !== sourceHostId)?.id ?? hosts[0]?.id);
  const [destPath, setDestPath] = useState("/root");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!destHostId) return;
    setLoading(true);
    setError("");
    fetch(`/api/files/${destHostId}?path=${encodeURIComponent(destPath)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setEntries(
          data.entries
            .filter((e: FileEntry) => e.type === "directory" && e.name !== "." && e.name !== "..")
            .sort((a: FileEntry, b: FileEntry) => a.name.localeCompare(b.name))
        );
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Erreur."))
      .finally(() => setLoading(false));
  }, [destHostId, destPath]);

  async function start() {
    setStarting(true);
    setError("");
    try {
      const res = await fetch("/api/files/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceHostId, sourcePath, destHostId, destPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onStarted(data.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg space-y-3 rounded border border-neutral-700 bg-neutral-950 p-4">
        <h2 className="text-sm font-semibold text-neutral-100">Copier vers une autre machine</h2>
        <p className="font-mono text-xs text-neutral-500">Source : {sourcePath}</p>

        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">Machine de destination</span>
          <select
            value={destHostId}
            onChange={(e) => {
              setDestHostId(Number(e.target.value));
              setDestPath("/root");
            }}
            className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
          >
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs text-neutral-400">Dossier de destination</span>
            <button
              onClick={() => setDestPath(destPath.split("/").slice(0, -1).join("/") || "/")}
              className="text-xs text-blue-400 hover:underline"
            >
              ↑ Parent
            </button>
          </div>
          <p className="mb-1 font-mono text-xs text-neutral-300">{destPath}</p>
          <div className="max-h-48 overflow-auto rounded border border-neutral-800">
            {loading && <p className="p-2 text-xs text-neutral-500">Chargement...</p>}
            {!loading &&
              entries.map((entry) => (
                <button
                  key={entry.name}
                  onClick={() => setDestPath(joinPath(destPath, entry.name))}
                  className="block w-full px-2 py-1 text-left text-xs text-blue-400 hover:bg-neutral-900"
                >
                  📁 {entry.name}
                </button>
              ))}
            {!loading && entries.length === 0 && (
              <p className="p-2 text-xs text-neutral-600">Aucun sous-dossier ici.</p>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            disabled={starting}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
          >
            Annuler
          </button>
          <button
            onClick={start}
            disabled={starting || !destHostId}
            className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-900/60 disabled:opacity-50"
          >
            {starting ? "Démarrage..." : `Copier ici`}
          </button>
        </div>
      </div>
    </div>
  );
}
