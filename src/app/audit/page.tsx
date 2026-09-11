"use client";

import { useCallback, useEffect, useState } from "react";

type Entry = { id: number; action: string; target: string | null; detail: string | null; created_at: string };

const CATEGORY_LABELS: Record<string, string> = {
  "": "Toutes les catégories",
  "auth.": "Authentification",
  "ssh.": "SSH",
  "files.": "Fichiers",
  "update.": "Mises à jour",
  "security.": "Sécurité",
  "firewall.": "Pare-feu",
  "backup.": "Sauvegardes",
};

export default function AuditPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState("");
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(async (before?: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (before) params.set("before", String(before));
      if (category) params.set("action", category);
      const res = await fetch(`/api/audit?${params}`);
      const data = await res.json();
      setEntries((prev) => (before ? [...prev, ...data.entries] : data.entries));
      setHasMore(data.entries.length === 100);
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Journal d&apos;audit</h1>
          <p className="mt-1 text-sm text-neutral-400">Historique de toutes les actions effectuées depuis le panel.</p>
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
        >
          {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded border border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Cible</th>
              <th className="px-3 py-2 font-medium">Détail</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-neutral-900">
                <td className="whitespace-nowrap px-3 py-2 text-neutral-500">
                  {new Date(`${e.created_at}Z`).toLocaleString("fr-FR")}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-neutral-200">{e.action}</td>
                <td className="px-3 py-2 text-neutral-400">{e.target || "—"}</td>
                <td className="max-w-md truncate px-3 py-2 text-neutral-500" title={e.detail || ""}>
                  {e.detail || "—"}
                </td>
              </tr>
            ))}
            {entries.length === 0 && !loading && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-neutral-600">
                  Aucune entrée.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <button
          onClick={() => load(entries[entries.length - 1]?.id)}
          disabled={loading}
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
        >
          {loading ? "Chargement..." : "Charger plus"}
        </button>
      )}
    </div>
  );
}
