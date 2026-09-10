"use client";

import { useEffect, useState } from "react";

type LicenseStatus = { activated: boolean; trialDays: number; daysRemaining: number | null; expired: boolean };

export default function TrialBanner() {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [key, setKey] = useState("");
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/license/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);

  async function activate(e: React.FormEvent) {
    e.preventDefault();
    setActivating(true);
    setError("");
    try {
      const res = await fetch("/api/license/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setStatus((s) => (s ? { ...s, activated: true, expired: false } : s));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setActivating(false);
    }
  }

  if (!status || status.activated) return null;

  if (status.expired) {
    return (
      <div className="border-b border-amber-900 bg-amber-950/40 px-4 py-3">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-amber-200">Ton essai de {status.trialDays} jours est terminé.</p>
            <p className="text-xs text-amber-300/80">
              La consultation reste disponible, mais les actions (SSH, Docker, sauvegardes, correctifs...) sont
              désactivées tant que le panel n&apos;est pas activé.
            </p>
          </div>
          <form onSubmit={activate} className="flex items-center gap-2">
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Clé d'activation"
              className="rounded border border-amber-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
            />
            <button
              type="submit"
              disabled={activating}
              className="rounded border border-amber-700 bg-amber-900/60 px-3 py-1.5 text-sm font-medium text-amber-100 hover:bg-amber-900 disabled:opacity-50"
            >
              {activating ? "Vérification..." : "Activer"}
            </button>
          </form>
        </div>
        {error && <p className="mx-auto mt-2 max-w-5xl text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="border-b border-neutral-800 bg-neutral-900/60 px-4 py-2">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-neutral-400">
          Version d&apos;essai — {status.daysRemaining} jour{(status.daysRemaining ?? 0) > 1 ? "s" : ""} restant
          {(status.daysRemaining ?? 0) > 1 ? "s" : ""}.
        </p>
        <form onSubmit={activate} className="flex items-center gap-2">
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Clé d'activation"
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100"
          />
          <button
            type="submit"
            disabled={activating}
            className="rounded border border-neutral-600 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
          >
            {activating ? "..." : "Activer"}
          </button>
        </form>
      </div>
      {error && <p className="mx-auto mt-1 max-w-5xl text-xs text-red-400">{error}</p>}
    </div>
  );
}
