"use client";

import { useEffect, useState } from "react";

type Thresholds = { authFailure: number; notFound: number; highVolume: number };

const FIELDS: { key: keyof Thresholds; label: string; help: string }[] = [
  {
    key: "authFailure",
    label: "Échecs d'authentification",
    help: "Nombre d'échecs de connexion depuis la même IP avant de la considérer suspecte.",
  },
  {
    key: "notFound",
    label: "Erreurs 404 en rafale",
    help: "Nombre de pages inexistantes demandées depuis la même IP (signe de scan).",
  },
  {
    key: "highVolume",
    label: "Volume de requêtes",
    help: "Nombre total de requêtes depuis la même IP jugé anormal.",
  },
];

export default function DetectionThresholdsPanel() {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Thresholds | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (open && !values) {
      fetch("/api/settings/log-thresholds")
        .then((r) => r.json())
        .then(setValues);
    }
  }, [open, values]);

  async function save() {
    if (!values) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/settings/log-thresholds", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage("Seuils enregistrés.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-neutral-300"
      >
        <span>Sensibilité de la détection des IP suspectes dans les logs</span>
        <span className="text-neutral-500">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-neutral-800 p-4">
          {!values ? (
            <p className="text-sm text-neutral-500">Chargement...</p>
          ) : (
            <>
              {FIELDS.map((f) => (
                <div key={f.key} className="flex items-center justify-between gap-4">
                  <div>
                    <label className="text-sm text-neutral-200">{f.label}</label>
                    <p className="text-xs text-neutral-500">{f.help}</p>
                  </div>
                  <input
                    type="number"
                    min={1}
                    value={values[f.key]}
                    onChange={(e) => setValues({ ...values, [f.key]: Number(e.target.value) })}
                    className="w-20 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
                  />
                </div>
              ))}
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={save}
                  disabled={saving}
                  className="rounded border border-neutral-600 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                >
                  {saving ? "Enregistrement..." : "Enregistrer"}
                </button>
                {message && <span className="text-xs text-neutral-400">{message}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
