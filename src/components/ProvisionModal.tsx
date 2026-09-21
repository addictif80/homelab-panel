"use client";

import { useState } from "react";

export type ProvisionSuggestion = {
  hostId: number | null;
  hostName: string | null;
  templateId: string | null;
  image: string;
  name: string;
  ports: string[];
  volumes: string[];
  env: string[];
  restartPolicy: string;
  explanation: string;
};

/**
 * One sentence in, a prefilled "Lancer un conteneur" form out — never a direct deploy. The
 * suggestion is shown for review before `onApply` hands it to the existing run form, so the
 * human still clicks the final "Lancer" themselves, exactly as if they'd typed it in by hand.
 */
export default function ProvisionModal({
  onClose,
  onApply,
}: {
  onClose: () => void;
  onApply: (s: ProvisionSuggestion) => void;
}) {
  const [sentence, setSentence] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [suggestion, setSuggestion] = useState<ProvisionSuggestion | null>(null);

  async function interpret() {
    if (!sentence.trim() || loading) return;
    setLoading(true);
    setError("");
    setSuggestion(null);
    try {
      const res = await fetch("/api/provision/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentence }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuggestion(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg space-y-3 rounded border border-neutral-700 bg-neutral-950 p-4">
        <h2 className="text-sm font-semibold text-neutral-100">Provisionner en une phrase</h2>
        <p className="text-xs text-neutral-500">
          Décris ce que tu veux déployer, en une phrase — l&apos;IA propose une machine, une image et une
          configuration à partir de tes modèles et de ton inventaire. Rien n&apos;est lancé sans que tu valides le
          formulaire pré-rempli ensuite.
        </p>
        <textarea
          value={sentence}
          onChange={(e) => setSentence(e.target.value)}
          placeholder="ex : installe un Nextcloud sur mon NAS"
          rows={2}
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}

        {suggestion && (
          <div className="rounded border border-purple-900 bg-purple-950/20 p-3 text-xs">
            <p className="mb-2 text-purple-200">{suggestion.explanation}</p>
            <dl className="space-y-1 text-neutral-400">
              <div>
                <dt className="inline text-neutral-500">Machine : </dt>
                <dd className="inline text-neutral-200">{suggestion.hostName ?? "non déterminée"}</dd>
              </div>
              <div>
                <dt className="inline text-neutral-500">Image : </dt>
                <dd className="inline font-mono text-neutral-200">{suggestion.image || "—"}</dd>
              </div>
              <div>
                <dt className="inline text-neutral-500">Nom : </dt>
                <dd className="inline font-mono text-neutral-200">{suggestion.name || "—"}</dd>
              </div>
              {suggestion.ports.length > 0 && (
                <div>
                  <dt className="inline text-neutral-500">Ports : </dt>
                  <dd className="inline font-mono text-neutral-200">{suggestion.ports.join(", ")}</dd>
                </div>
              )}
              {suggestion.volumes.length > 0 && (
                <div>
                  <dt className="inline text-neutral-500">Volumes : </dt>
                  <dd className="inline font-mono text-neutral-200">{suggestion.volumes.join(", ")}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800">
            Annuler
          </button>
          {!suggestion ? (
            <button
              onClick={interpret}
              disabled={loading || !sentence.trim()}
              className="rounded border border-purple-700 bg-purple-900/40 px-3 py-1.5 text-sm text-purple-200 hover:bg-purple-900/60 disabled:opacity-50"
            >
              {loading ? "Interprétation..." : "Interpréter"}
            </button>
          ) : (
            <button
              onClick={() => onApply(suggestion)}
              disabled={!suggestion.image}
              className="rounded border border-emerald-700 bg-emerald-900/40 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-900/60 disabled:opacity-50"
            >
              Pré-remplir le formulaire
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
