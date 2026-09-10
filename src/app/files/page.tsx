"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CopyToHostModal from "@/components/CopyToHostModal";

type Host = { id: number; name: string };
type FileEntry = { name: string; type: "file" | "directory" | "symlink" | "other"; size: number; modifiedAt: number };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

export default function FilesPage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [hostId, setHostId] = useState<number | null>(null);
  const [currentPath, setCurrentPath] = useState("/root");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [copySource, setCopySource] = useState<string | null>(null);
  const [copyJobId, setCopyJobId] = useState<string | null>(null);
  const [copyJob, setCopyJob] = useState<{ status: string; log: string } | null>(null);

  useEffect(() => {
    fetch("/api/hosts")
      .then((r) => r.json())
      .then((d) => {
        setHosts(d.hosts);
        if (d.hosts.length > 0) setHostId(d.hosts[0].id);
      });
  }, []);

  const load = useCallback(async (id: number, p: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/files/${id}?path=${encodeURIComponent(p)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEntries(
        [...data.entries].sort((a, b) =>
          a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hostId) load(hostId, currentPath);
  }, [hostId, currentPath, load]);

  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!copyJobId) return;
    let cancelled = false;
    const poll = async () => {
      const res = await fetch(`/api/files/copy/${copyJobId}`);
      const data = await res.json();
      if (cancelled || !data.job) return;
      setCopyJob(data.job);
      requestAnimationFrame(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
      });
      if (data.job.status === "running") {
        setTimeout(poll, 1500);
      } else if (hostId) {
        load(hostId, currentPath);
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [copyJobId, hostId, currentPath, load]);

  function goUp() {
    const parent = currentPath.split("/").slice(0, -1).join("/") || "/";
    setCurrentPath(parent);
  }

  async function openFile(name: string) {
    if (!hostId) return;
    const full = joinPath(currentPath, name);
    const res = await fetch(`/api/files/${hostId}/content?path=${encodeURIComponent(full)}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      return;
    }
    setEditingFile(full);
    setEditingContent(data.content);
  }

  async function saveFile() {
    if (!hostId || !editingFile) return;
    const res = await fetch(`/api/files/${hostId}/content?path=${encodeURIComponent(editingFile)}`, {
      method: "PUT",
      body: editingContent,
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error);
      return;
    }
    setEditingFile(null);
  }

  async function deleteEntry(entry: FileEntry) {
    if (!hostId) return;
    const full = joinPath(currentPath, entry.name);
    if (!confirm(`Supprimer ${full} ?`)) return;
    const res = await fetch(
      `/api/files/${hostId}?path=${encodeURIComponent(full)}&isDir=${entry.type === "directory" ? "1" : "0"}`,
      { method: "DELETE" }
    );
    if (res.ok) load(hostId, currentPath);
    else {
      const data = await res.json();
      setError(data.error);
    }
  }

  async function createFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!hostId || !newFolderName) return;
    const full = joinPath(currentPath, newFolderName);
    const res = await fetch(`/api/files/${hostId}/mkdir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: full }),
    });
    if (res.ok) {
      setNewFolderName("");
      setShowNewFolder(false);
      load(hostId, currentPath);
    } else {
      const data = await res.json();
      setError(data.error);
    }
  }

  async function uploadFile(file: File) {
    if (!hostId) return;
    const full = joinPath(currentPath, file.name);
    const buffer = await file.arrayBuffer();
    const res = await fetch(`/api/files/${hostId}/content?path=${encodeURIComponent(full)}`, {
      method: "PUT",
      body: buffer,
    });
    if (res.ok) load(hostId, currentPath);
    else {
      const data = await res.json();
      setError(data.error);
    }
  }

  function downloadFile(name: string) {
    if (!hostId) return;
    const full = joinPath(currentPath, name);
    window.open(`/api/files/${hostId}/content?path=${encodeURIComponent(full)}&download=1`, "_blank");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Explorateur de fichiers</h1>
          <p className="text-sm text-neutral-400 font-mono">{currentPath}</p>
        </div>
        <select
          value={hostId ?? ""}
          onChange={(e) => {
            setHostId(Number(e.target.value));
            setCurrentPath("/root");
          }}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
        >
          {hosts.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={goUp} className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800">
          ↑ Dossier parent
        </button>
        <button
          onClick={() => setShowNewFolder((s) => !s)}
          className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
        >
          + Dossier
        </button>
        <label className="cursor-pointer rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800">
          Uploader
          <input
            type="file"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])}
          />
        </label>
      </div>

      {showNewFolder && (
        <form onSubmit={createFolder} className="flex gap-2">
          <input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="nom-du-dossier"
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
            autoFocus
          />
          <button type="submit" className="rounded bg-blue-600 text-white px-3 py-1 text-sm hover:bg-blue-500">
            Créer
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-neutral-500">Chargement...</p>}

      <div className="overflow-auto rounded border border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900 text-left text-neutral-400">
            <tr>
              <th className="px-3 py-2 font-medium">Nom</th>
              <th className="px-3 py-2 font-medium">Taille</th>
              <th className="px-3 py-2 font-medium">Modifié</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries
              .filter((e) => e.name !== "." && e.name !== "..")
              .map((entry) => (
                <tr key={entry.name} className="border-t border-neutral-800">
                  <td className="px-3 py-2">
                    {entry.type === "directory" ? (
                      <button
                        onClick={() => setCurrentPath(joinPath(currentPath, entry.name))}
                        className="text-blue-400 hover:underline"
                      >
                        📁 {entry.name}
                      </button>
                    ) : (
                      <button onClick={() => openFile(entry.name)} className="hover:underline">
                        📄 {entry.name}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-neutral-400">
                    {entry.type === "file" ? formatSize(entry.size) : "—"}
                  </td>
                  <td className="px-3 py-2 text-neutral-400">
                    {new Date(entry.modifiedAt).toLocaleString("fr-FR")}
                  </td>
                  <td className="px-3 py-2 space-x-2">
                    {entry.type === "file" && (
                      <button
                        onClick={() => downloadFile(entry.name)}
                        className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800"
                      >
                        Télécharger
                      </button>
                    )}
                    <button
                      onClick={() => setCopySource(joinPath(currentPath, entry.name))}
                      className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800"
                    >
                      Copier vers...
                    </button>
                    <button
                      onClick={() => deleteEntry(entry)}
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

      {editingFile && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-8">
          <div className="flex h-full w-full max-w-3xl flex-col rounded border border-neutral-700 bg-neutral-950 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-sm">{editingFile}</span>
              <div className="space-x-2">
                <button onClick={saveFile} className="rounded bg-blue-600 text-white px-3 py-1 text-sm hover:bg-blue-500">
                  Enregistrer
                </button>
                <button
                  onClick={() => setEditingFile(null)}
                  className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
                >
                  Fermer
                </button>
              </div>
            </div>
            <textarea
              value={editingContent}
              onChange={(e) => setEditingContent(e.target.value)}
              className="flex-1 resize-none rounded border border-neutral-800 bg-black p-3 font-mono text-xs"
              spellCheck={false}
            />
          </div>
        </div>
      )}

      {copySource && hostId && (
        <CopyToHostModal
          hosts={hosts}
          sourceHostId={hostId}
          sourcePath={copySource}
          onClose={() => setCopySource(null)}
          onStarted={(jobId) => {
            setCopySource(null);
            setCopyJobId(jobId);
            setCopyJob({ status: "running", log: "" });
          }}
        />
      )}

      {copyJobId && copyJob && (
        <div className="fixed bottom-4 right-4 z-40 w-full max-w-md rounded border border-neutral-700 bg-neutral-950 shadow-xl">
          <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
            <span className="text-sm text-neutral-200">
              {copyJob.status === "running" ? "Copie en cours..." : copyJob.status === "success" ? "Copie terminée" : "Échec de la copie"}
            </span>
            <button
              onClick={() => {
                setCopyJobId(null);
                setCopyJob(null);
              }}
              className="text-xs text-neutral-500 hover:text-neutral-300"
            >
              Fermer
            </button>
          </div>
          <div ref={logRef} className="max-h-48 overflow-auto bg-black p-2 font-mono text-[11px] text-neutral-300">
            <pre className="whitespace-pre-wrap">{copyJob.log || "Démarrage..."}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
