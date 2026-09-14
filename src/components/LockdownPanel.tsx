"use client";

import { useState } from "react";

export default function LockdownPanel() {
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [activating, setActivating] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  async function activate() {
    setActivating(true);
    setError("");
    try {
      const res = await fetch("/api/security/lockdown/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: confirmText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(
        `Lockdown activé : ${data.blockedIps} IP suspecte(s) reforcée(s), ${data.revokedDevices} appareil(s) de confiance révoqué(s).`
      );
      setConfirming(false);
      setConfirmText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setActivating(false);
    }
  }

  return (
    <section className="space-y-2 rounded border border-red-900/60 bg-red-950/10 p-4">
      <h2 className="text-sm font-semibold text-red-200">Lockdown</h2>
      <p className="text-xs text-neutral-400">
        En cas de suspicion de compromission : révoque d&apos;un coup toutes les sessions et appareils de confiance
        (sauf celui-ci), renforce le blocage de chaque IP déjà repérée sur toute l&apos;infra, et met en pause les
        sauvegardes automatiques jusqu&apos;à ce que tu lèves le lockdown. Ne coupe pas l&apos;accès SSH direct aux
        machines — reste utilisable pour investiguer pendant le lockdown.
      </p>

      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="rounded border border-red-800 bg-red-900/40 px-3 py-1.5 text-sm text-red-200 hover:bg-red-900/60"
        >
          Activer le lockdown
        </button>
      ) : (
        <div className="space-y-2 rounded border border-red-900 bg-red-950/30 p-3">
          <p className="text-sm text-red-200">
            Tape <strong>LOCKDOWN</strong> pour confirmer :
          </p>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="w-full max-w-xs rounded border border-red-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                setConfirming(false);
                setConfirmText("");
              }}
              className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
            >
              Annuler
            </button>
            <button
              onClick={activate}
              disabled={confirmText !== "LOCKDOWN" || activating}
              className="rounded border border-red-700 bg-red-900/60 px-3 py-1.5 text-sm text-red-100 hover:bg-red-900 disabled:opacity-50"
            >
              {activating ? "Activation..." : "Confirmer le lockdown"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {result && <p className="text-sm text-emerald-400">{result}</p>}
    </section>
  );
}
