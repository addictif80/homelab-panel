"use client";

import { useEffect, useState } from "react";

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  to: string;
  enabled: boolean;
};

const EMPTY: SmtpConfig = { host: "", port: 587, secure: false, user: "", from: "", to: "", enabled: false };

const INPUT_CLASS = "w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100";

export default function SmtpSettingsPanel() {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<SmtpConfig | null>(null);
  const [hasPassword, setHasPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (open && !config) {
      fetch("/api/settings/smtp")
        .then((r) => r.json())
        .then((data) => {
          setConfig(data.config || EMPTY);
          setHasPassword(data.hasPassword);
        });
    }
  }, [open, config]);

  async function save() {
    if (!config) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/settings/smtp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, password: password || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (password) setHasPassword(true);
      setPassword("");
      setMessage("Configuration enregistrée.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setMessage("");
    try {
      const res = await fetch("/api/settings/smtp/test", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage("Email de test envoyé, vérifie ta boîte de réception.");
    } catch (err) {
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
        <span>Notifications par email (serveur SMTP personnalisé)</span>
        <span className="text-neutral-500">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-neutral-800 p-4">
          {!config ? (
            <p className="text-sm text-neutral-500">Chargement...</p>
          ) : (
            <>
              <p className="text-xs text-neutral-500">
                Reçois un email récapitulatif (nouvelles alertes de sécurité, mises à jour en attente, IP suspectes)
                dès qu&apos;un problème apparaît, avec un rappel quotidien tant qu&apos;il n&apos;est pas corrigé.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Serveur SMTP">
                  <input
                    value={config.host}
                    onChange={(e) => setConfig({ ...config, host: e.target.value })}
                    placeholder="smtp.exemple.fr"
                    className={INPUT_CLASS}
                  />
                </Field>
                <Field label="Port">
                  <input
                    type="number"
                    value={config.port}
                    onChange={(e) => setConfig({ ...config, port: Number(e.target.value) })}
                    className={INPUT_CLASS}
                  />
                </Field>
                <Field label="Utilisateur">
                  <input
                    value={config.user}
                    onChange={(e) => setConfig({ ...config, user: e.target.value })}
                    className={INPUT_CLASS}
                  />
                </Field>
                <Field label={hasPassword ? "Mot de passe (déjà défini)" : "Mot de passe"}>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={hasPassword ? "•••••••• (laisser vide pour garder)" : ""}
                    className={INPUT_CLASS}
                  />
                </Field>
                <Field label="Adresse expéditeur">
                  <input
                    value={config.from}
                    onChange={(e) => setConfig({ ...config, from: e.target.value })}
                    placeholder="panel@ton-domaine.fr"
                    className={INPUT_CLASS}
                  />
                </Field>
                <Field label="Adresse destinataire">
                  <input
                    value={config.to}
                    onChange={(e) => setConfig({ ...config, to: e.target.value })}
                    placeholder="toi@exemple.fr"
                    className={INPUT_CLASS}
                  />
                </Field>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-neutral-300">
                  <input
                    type="checkbox"
                    checked={config.secure}
                    onChange={(e) => setConfig({ ...config, secure: e.target.checked })}
                  />
                  Connexion chiffrée (TLS implicite, port 465 en général)
                </label>
                <label className="flex items-center gap-2 text-sm text-neutral-300">
                  <input
                    type="checkbox"
                    checked={config.enabled}
                    onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                  />
                  Activer les notifications
                </label>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={save}
                  disabled={saving}
                  className="rounded border border-neutral-600 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                >
                  {saving ? "Enregistrement..." : "Enregistrer"}
                </button>
                <button
                  onClick={sendTest}
                  disabled={testing}
                  className="rounded border border-neutral-600 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                >
                  {testing ? "Envoi..." : "Envoyer un test"}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-neutral-400">{label}</span>
      {children}
    </label>
  );
}
