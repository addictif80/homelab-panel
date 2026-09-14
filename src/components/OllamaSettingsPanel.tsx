"use client";

import { useEffect, useState } from "react";

type OllamaConfig = { baseUrl: string; model: string; language: string };

const EMPTY: OllamaConfig = { baseUrl: "", model: "", language: "fr" };

const INPUT_CLASS = "w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100";

export default function OllamaSettingsPanel() {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<OllamaConfig | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageOk, setMessageOk] = useState(true);

  useEffect(() => {
    if (open && !config) {
      fetch("/api/settings/ollama")
        .then((r) => r.json())
        .then((data) => setConfig(data.config || EMPTY));
    }
  }, [open, config]);

  async function save() {
    if (!config) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/settings/ollama", {
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
      const res = await fetch("/api/settings/ollama/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      setMessageOk(data.ok);
      setMessage(data.message);
      setAvailableModels(data.models || []);
      if (data.ok && data.models?.length && !config.model) {
        setConfig({ ...config, model: data.models[0] });
      }
    } catch (err) {
      setMessageOk(false);
      setMessage(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-neutral-300"
      >
        <span>Assistant IA (Ollama)</span>
        <span className="text-neutral-500">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-neutral-800 p-4">
          {!config ? (
            <p className="text-sm text-neutral-500">Chargement...</p>
          ) : (
            <>
              <p className="text-xs text-neutral-500">
                Connecte une instance Ollama (auto-hébergée, sur ton réseau) pour obtenir de l&apos;aide dans le guide de
                résolution des problèmes de sécurité et discuter depuis la page Assistant IA. Rien n&apos;est envoyé à
                un service tiers : tout reste entre le panel et ton serveur Ollama.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Adresse du serveur">
                  <input
                    value={config.baseUrl}
                    onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
                    placeholder="http://192.168.1.50:11434"
                    className={INPUT_CLASS}
                  />
                </Field>
                <Field label="Langue des réponses">
                  <select
                    value={config.language}
                    onChange={(e) => setConfig({ ...config, language: e.target.value })}
                    className={INPUT_CLASS}
                  >
                    <option value="fr">Français</option>
                    <option value="en">Anglais</option>
                  </select>
                </Field>
                <Field label="Modèle">
                  {availableModels.length > 0 ? (
                    <select
                      value={config.model}
                      onChange={(e) => setConfig({ ...config, model: e.target.value })}
                      className={INPUT_CLASS}
                    >
                      <option value="">— choisir —</option>
                      {availableModels.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={config.model}
                      onChange={(e) => setConfig({ ...config, model: e.target.value })}
                      placeholder="llama3.1:8b"
                      className={INPUT_CLASS}
                    />
                  )}
                </Field>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={test}
                  disabled={testing || !config.baseUrl}
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
