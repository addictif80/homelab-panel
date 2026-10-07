"use client";

import { useEffect, useState } from "react";

type OneMinConfig = { apiKey: string; model: string };

const EMPTY: OneMinConfig = { apiKey: "", model: "gpt-4o-mini" };

const INPUT_CLASS = "w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100";

export default function OneMinSettingsPanel() {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<OneMinConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageOk, setMessageOk] = useState(true);

  useEffect(() => {
    if (open && !config) {
      fetch("/api/settings/onemin")
        .then((r) => r.json())
        .then((data) => setConfig(data.config || EMPTY));
    }
  }, [open, config]);

  async function save() {
    if (!config) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/settings/onemin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessageOk(true);
      setMessage("Configuration enregistrée.");
    } catch (err) {
      setMessageOk(false);
      setMessage(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    if (!config) return;
    setTesting(true);
    setMessage("");
    try {
      const res = await fetch("/api/settings/onemin/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      setMessageOk(data.ok);
      setMessage(data.message);
    } catch (err) {
      setMessageOk(false);
      setMessage(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="card">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-neutral-300"
      >
        <span>Assistant IA (1min.ai)</span>
        <span className="text-neutral-500">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-neutral-800 p-4">
          {!config ? (
            <p className="text-sm text-neutral-500">Chargement...</p>
          ) : (
            <>
              <p className="text-xs text-neutral-500">
                Service cloud (1min.ai) — contrairement à Ollama, les messages envoyés à l&apos;assistant transitent
                par leur API. Clé API disponible sur{" "}
                <a href="https://app.1min.ai/" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
                  app.1min.ai
                </a>
                .
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Clé API">
                  <input
                    type="password"
                    value={config.apiKey}
                    onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                    placeholder="sk-..."
                    className={INPUT_CLASS}
                  />
                </Field>
                <Field label="Modèle">
                  <input
                    value={config.model}
                    onChange={(e) => setConfig({ ...config, model: e.target.value })}
                    placeholder="gpt-4o-mini"
                    className={INPUT_CLASS}
                  />
                </Field>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={test}
                  disabled={testing || !config.apiKey}
                  className="rounded border border-neutral-600 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                >
                  {testing ? "Test en cours..." : "Tester la connexion"}
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="rounded border border-neutral-600 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                >
                  {saving ? "Enregistrement..." : "Enregistrer"}
                </button>
                {message && (
                  <span className={`text-xs ${messageOk ? "text-emerald-400" : "text-red-400"}`}>{message}</span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-neutral-400">{label}</span>
      {children}
    </label>
  );
}
