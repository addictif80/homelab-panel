"use client";

import { useEffect, useState } from "react";

export default function UptimePage() {
  const [url, setUrl] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [frameFailed, setFrameFailed] = useState(false);

  useEffect(() => {
    fetch("/api/settings/uptime-kuma")
      .then((r) => r.json())
      .then((data) => {
        setUrl(data.url || null);
        setInput(data.url || "");
      });
  }, []);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/settings/uptime-kuma", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: input }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUrl(data.url);
      setFrameFailed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Uptime Kuma</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Supervision de la disponibilité de tes services, affichée directement ici.
          </p>
        </div>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
          >
            Ouvrir dans un nouvel onglet
          </a>
        )}
      </div>

      <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
        <label className="mb-1 block text-xs text-neutral-400">
          Adresse de ton instance Uptime Kuma (domaine ou ip:port)
        </label>
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="https://uptime.abhd.fr ou http://192.168.0.50:3001"
            className="flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
          />
          <button
            onClick={save}
            disabled={saving}
            className="rounded border border-neutral-600 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
          >
            {saving ? "Enregistrement..." : "Enregistrer"}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </div>

      {url && (
        <div className="min-h-[70vh] flex-1 overflow-hidden rounded border border-neutral-800 bg-neutral-900">
          {frameFailed ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm text-neutral-400">
              <p>
                Impossible d&apos;afficher Uptime Kuma dans le panel (il refuse probablement d&apos;être intégré dans
                une iframe pour des raisons de sécurité).
              </p>
              <a href={url} target="_blank" rel="noreferrer" className="text-blue-400 underline">
                Ouvrir Uptime Kuma dans un nouvel onglet
              </a>
            </div>
          ) : (
            <iframe
              src={url}
              className="h-full min-h-[70vh] w-full"
              onError={() => setFrameFailed(true)}
              title="Uptime Kuma"
            />
          )}
        </div>
      )}
    </div>
  );
}
