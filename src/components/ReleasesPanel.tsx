"use client";

import { useEffect, useState } from "react";

type Release = { id: string; version: string; changelog: string; createdAt: string };

export default function ReleasesPanel() {
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [version, setVersion] = useState("");
  const [changelog, setChangelog] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/seller/releases")
      .then((r) => r.json())
      .then((d) => setReleases(d.releases));
  }

  useEffect(() => {
    load();
  }, []);

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    setPublishing(true);
    setError("");
    try {
      const res = await fetch("/api/seller/releases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version, changelog }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setVersion("");
      setChangelog("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="page-title">Mises à jour</h2>
        <p className="page-subtitle">
          Publie une version après l&apos;avoir déployée ici (et bumpé <code>package.json</code>) — les instances
          clientes déjà vendues verront une alerte et pourront se mettre à jour en un clic, sans repasser par un
          nouveau téléchargement manuel.
        </p>
      </div>

      <form onSubmit={publish} className="max-w-md space-y-3 rounded border border-neutral-800 p-4">
        <div>
          <label className="mb-1 block text-xs text-neutral-400">Version (doit correspondre à package.json)</label>
          <input
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="1.2.0"
            pattern="\d+\.\d+\.\d+"
            required
            className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-neutral-400">Notes de version (affichées aux clients)</label>
          <textarea
            value={changelog}
            onChange={(e) => setChangelog(e.target.value)}
            rows={3}
            className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={publishing}
          className="rounded bg-blue-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
        >
          {publishing ? "Publication..." : "Publier cette version"}
        </button>
      </form>

      <div className="overflow-auto rounded border border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900 text-left text-neutral-400">
            <tr>
              <th className="px-3 py-2 font-medium">Version</th>
              <th className="px-3 py-2 font-medium">Notes</th>
              <th className="px-3 py-2 font-medium">Publiée le</th>
            </tr>
          </thead>
          <tbody>
            {releases?.map((r) => (
              <tr key={r.id} className="border-t border-neutral-800">
                <td className="px-3 py-2 font-mono text-xs">{r.version}</td>
                <td className="px-3 py-2 text-neutral-400">{r.changelog || "—"}</td>
                <td className="px-3 py-2 text-neutral-500">{new Date(`${r.createdAt}Z`).toLocaleString("fr-FR")}</td>
              </tr>
            ))}
            {releases?.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-neutral-600">
                  Aucune version publiée pour l&apos;instant.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
