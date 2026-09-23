"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Deliberately not a markdown library — generateSurvivalDoc() only ever emits a small, fixed
 * subset (headers, tables, bullet lists, bold) with no user-controlled input in the mix (it's
 * built from the panel's own inventory data), so a full parser/renderer dependency would be a lot
 * of weight for a handful of patterns this covers directly.
 */
function renderMarkdown(md: string): React.ReactNode[] {
  const lines = md.split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  function renderInline(text: string): React.ReactNode {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, idx) =>
      part.startsWith("**") && part.endsWith("**") ? <strong key={idx}>{part.slice(2, -2)}</strong> : part
    );
  }

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("### ")) {
      blocks.push(
        <h3 key={key++} className="mt-5 text-base font-semibold text-neutral-100">
          {line.slice(4)}
        </h3>
      );
      i++;
    } else if (line.startsWith("## ")) {
      blocks.push(
        <h2 key={key++} className="mt-7 border-t border-neutral-800 pt-5 text-lg font-semibold text-neutral-100">
          {line.slice(3)}
        </h2>
      );
      i++;
    } else if (line.startsWith("# ")) {
      blocks.push(
        <h1 key={key++} className="text-2xl font-bold text-neutral-100">
          {line.slice(2)}
        </h1>
      );
      i++;
    } else if (line.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      const rows = tableLines.filter((l) => !/^\|[\s-]*\|/.test(l)).map((l) =>
        l
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim())
      );
      const [header, ...body] = rows;
      blocks.push(
        <div key={key++} className="mt-3 overflow-auto rounded border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-left text-neutral-400">
              <tr>
                {header.map((c, idx) => (
                  <th key={idx} className="px-3 py-2 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, rIdx) => (
                <tr key={rIdx} className="border-t border-neutral-800">
                  {r.map((c, cIdx) => (
                    <td key={cIdx} className="px-3 py-2 text-neutral-300">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    } else if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith("- ")) {
        items.push(lines[i].slice(2));
        i++;
      }
      blocks.push(
        <ul key={key++} className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-300">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it)}</li>
          ))}
        </ul>
      );
    } else if (line.startsWith("_") && line.endsWith("_") && line.length > 1) {
      blocks.push(
        <p key={key++} className="mt-2 text-sm italic text-neutral-500">
          {line.slice(1, -1)}
        </p>
      );
      i++;
    } else if (line.trim() === "") {
      i++;
    } else {
      blocks.push(
        <p key={key++} className="mt-2 text-sm text-neutral-300">
          {renderInline(line)}
        </p>
      );
      i++;
    }
  }

  return blocks;
}

export default function ArchitecturePage() {
  const [doc, setDoc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/settings/survival-doc");
      if (!res.ok) throw new Error("Erreur lors de la génération du document.");
      setDoc(await res.text());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Documentation d&apos;architecture</h1>
          <p className="text-sm text-neutral-400">
            Générée en direct depuis l&apos;inventaire, la topologie, les sauvegardes et les conteneurs Docker
            réels — toujours à jour, jamais à mettre à jour à la main.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
          >
            {loading ? "Génération..." : "Régénérer"}
          </button>
          <a
            href="/api/settings/survival-doc?download=1"
            className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-900/60"
          >
            Télécharger (.md)
          </a>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && !doc && <p className="text-sm text-neutral-500">Génération du document...</p>}
      {doc && <div className="rounded border border-neutral-800 bg-neutral-950 p-6">{renderMarkdown(doc)}</div>}
    </div>
  );
}
