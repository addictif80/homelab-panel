"use client";

import { useEffect, useState } from "react";

type FileEntry = { name: string; type: "file" | "directory" | "symlink" | "other"; size: number; modifiedAt: number };

function parentOf(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx <= 0 ? "/" : trimmed.slice(0, idx);
}

function joinPath(base: string, name: string): string {
  return base === "/" ? `/${name}` : `${base}/${name}`;
}

/** Folder browser over the same SFTP connection as the File Explorer — lets a backup plan's
 * source/destination path be picked by navigating the real filesystem instead of typed blind.
 * Browses as the plain SSH login user (SFTP has no sudo concept), so a directory only readable by
 * root won't show up here even if the backup engine itself can reach it via sudo — a real but
 * secondary limitation, worth it for the common case of browsing normal NAS/data volumes. */
export default function DirectoryPicker({
  hostId,
  initialPath,
  onSelect,
  onClose,
}: {
  hostId: number;
  initialPath: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [path, setPath] = useState(initialPath || "/");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    fetch(`/api/files/${hostId}?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setEntries((d.entries as FileEntry[]).filter((e) => e.type === "directory").sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Erreur."))
      .finally(() => setLoading(false));
  }, [hostId, path]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded border border-neutral-700 bg-neutral-950 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-100">Choisir un dossier</h3>
          <button type="button" onClick={onClose} className="text-neutral-500 hover:text-neutral-300">
            ✕
          </button>
        </div>

        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          className="mb-2 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 font-mono text-xs text-neutral-100"
        />

        <div className="flex-1 overflow-auto rounded border border-neutral-800">
          {loading && <p className="p-3 text-xs text-neutral-500">Chargement...</p>}
          {error && <p className="p-3 text-xs text-red-400">{error}</p>}
          {!loading && !error && (
            <ul className="divide-y divide-neutral-900">
              {path !== "/" && (
                <li>
                  <button
                    type="button"
                    onClick={() => setPath(parentOf(path))}
                    className="w-full px-3 py-1.5 text-left text-sm text-neutral-400 hover:bg-neutral-900"
                  >
                    .. (dossier parent)
                  </button>
                </li>
              )}
              {entries.map((e) => (
                <li key={e.name}>
                  <button
                    type="button"
                    onClick={() => setPath(joinPath(path, e.name))}
                    className="w-full px-3 py-1.5 text-left text-sm text-neutral-200 hover:bg-neutral-900"
                  >
                    📁 {e.name}
                  </button>
                </li>
              ))}
              {entries.length === 0 && <li className="p-3 text-xs text-neutral-600">Aucun sous-dossier.</li>}
            </ul>
          )}
        </div>

        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => onSelect(path)}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
          >
            Choisir « {path} »
          </button>
        </div>
      </div>
    </div>
  );
}
