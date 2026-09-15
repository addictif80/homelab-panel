"use client";

import { useEffect, useState } from "react";

type LicenseStatus = {
  activated: boolean;
  isSellerInstance: boolean;
  licenseType?: "lifetime" | "subscription";
  trialDays: number;
  daysRemaining: number | null;
  expired: boolean;
  activationKey: string | null;
  activatedAt: string | null;
  validUntil: string | null;
};

function formatDate(iso: string): string {
  return new Date(iso.endsWith("Z") ? iso : `${iso}Z`).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export default function LicensePanel() {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [key, setKey] = useState("");
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

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
      const refreshed = await (await fetch("/api/license/status")).json();
      setStatus(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setActivating(false);
    }
  }

  function copyKey() {
    if (!status?.activationKey) return;
    navigator.clipboard.writeText(status.activationKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-sm font-semibold text-neutral-100">Licence</h2>

      {!status ? (
        <p className="mt-2 text-sm text-neutral-500">Chargement...</p>
      ) : status.isSellerInstance ? (
        <p className="mt-2 text-sm text-neutral-400">
          Instance du vendeur — licence illimitée, aucune activation requise.
        </p>
      ) : status.activationKey ? (
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span
              className={`rounded border px-2 py-0.5 text-xs ${
                status.expired
                  ? "border-amber-800 bg-amber-950/40 text-amber-300"
                  : "border-emerald-900 bg-emerald-950/30 text-emerald-300"
              }`}
            >
              {status.expired
                ? "Abonnement expiré"
                : status.licenseType === "subscription"
                  ? "Abonnement actif"
                  : "Licence à vie"}
            </span>
            {status.activatedAt && (
              <span className="text-xs text-neutral-500">Activée le {formatDate(status.activatedAt)}</span>
            )}
          </div>

          {status.licenseType === "subscription" && status.validUntil && (
            <p className="text-xs text-neutral-400">
              {status.expired ? "Expirée depuis le" : "Renouvellement le"} {formatDate(status.validUntil)}
              {!status.expired && " — se renouvelle automatiquement, rien à faire."}
            </p>
          )}

          <div className="flex items-center gap-2">
            <code className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-300">
              {status.activationKey}
            </code>
            <button onClick={copyKey} className="text-xs text-blue-400 hover:underline">
              {copied ? "Copié !" : "Copier"}
            </button>
          </div>

          {status.expired && (
            <p className="text-xs text-amber-300/80">
              La consultation reste disponible, mais les actions sont désactivées tant que le paiement n&apos;est
              pas régularisé. Le panel se réactive automatiquement dès que le renouvellement est confirmé.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-neutral-400">
            {status.expired
              ? `Ton essai de ${status.trialDays} jours est terminé.`
              : `Version d'essai — ${status.daysRemaining} jour${(status.daysRemaining ?? 0) > 1 ? "s" : ""} restant${(status.daysRemaining ?? 0) > 1 ? "s" : ""}.`}
          </p>
          <form onSubmit={activate} className="flex items-center gap-2">
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Clé d'activation"
              className="input"
            />
            <button
              type="submit"
              disabled={activating}
              className="btn-primary shrink-0 disabled:opacity-50"
            >
              {activating ? "Vérification..." : "Activer"}
            </button>
          </form>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}
