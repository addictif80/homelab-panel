"use client";

import { useEffect, useState } from "react";

type ScheduleSettings = { checkIntervalMinutes: number; renotifyAfterHours: number; minSendGapMinutes: number };

const FIELDS: { key: keyof ScheduleSettings; label: string; help: string; unit: string }[] = [
  {
    key: "checkIntervalMinutes",
    label: "Intervalle de vérification",
    help: "Fréquence à laquelle le Centre de sécurité rescanne les machines pour de nouvelles alertes.",
    unit: "minutes",
  },
  {
    key: "renotifyAfterHours",
    label: "Rappel d'une alerte persistante",
    help: "Délai avant de rappeler par email une même alerte tant qu'elle n'est pas corrigée ou ignorée.",
    unit: "heures",
  },
  {
    key: "minSendGapMinutes",
    label: "Écart minimal entre deux emails",
    help: "Empêche l'envoi de deux emails de notification trop rapprochés, quelle qu'en soit la cause.",
    unit: "minutes",
  },
];

export default function NotificationScheduleSettingsPanel() {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<ScheduleSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open && !values) {
      fetch("/api/settings/notification-schedule")
        .then((r) => r.json())
        .then(setValues);
    }
  }, [open, values]);

  async function save() {
    if (!values) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/settings/notification-schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage("Réglages enregistrés — pris en compte dès la prochaine vérification.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
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
        <span>Fréquence des vérifications et des emails de sécurité</span>
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
                  <div className="flex shrink-0 items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      value={values[f.key]}
                      onChange={(e) => setValues({ ...values, [f.key]: Number(e.target.value) })}
                      className="w-20 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
                    />
                    <span className="text-xs text-neutral-500">{f.unit}</span>
                  </div>
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
                {message && <span className="text-xs text-emerald-400">{message}</span>}
                {error && <span className="text-xs text-red-400">{error}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
