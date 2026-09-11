"use client";

import { useEffect, useState } from "react";

type ProxyHost = {
  id: number;
  domainNames: string[];
  forwardScheme: "http" | "https";
  forwardHost: string;
  forwardPort: number;
  sslForced: boolean;
  enabled: boolean;
  certificateId: number | null;
};

const INPUT_CLASS = "w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100";

const EMPTY_FORM = { domainNames: "", forwardScheme: "http" as "http" | "https", forwardHost: "", forwardPort: 80, sslForced: false };

export default function ProxyPage() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [hasPassword, setHasPassword] = useState(false);

  const [hosts, setHosts] = useState<ProxyHost[] | null>(null);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [renewing, setRenewing] = useState<number | null>(null);

  function loadConfig() {
    fetch("/api/settings/npm")
      .then((r) => r.json())
      .then((d) => {
        setConfigured(!!d.config);
        if (d.config) {
          setBaseUrl(d.config.baseUrl);
          setEmail(d.config.email);
        }
        setHasPassword(d.hasPassword);
      });
  }

  function loadHosts() {
    setError("");
    fetch("/api/npm/hosts")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setHosts(d.hosts);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Erreur."));
  }

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    if (configured) loadHosts();
  }, [configured]);

  async function saveConfig() {
    const res = await fetch("/api/settings/npm", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl, email, password: password || undefined }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      return;
    }
    setPassword("");
    setShowConfig(false);
    setConfigured(true);
  }

  async function createHost() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/npm/hosts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domainNames: form.domainNames.split(",").map((d) => d.trim()).filter(Boolean),
          forwardScheme: form.forwardScheme,
          forwardHost: form.forwardHost,
          forwardPort: Number(form.forwardPort),
          sslForced: form.sslForced,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setForm(EMPTY_FORM);
      setShowCreate(false);
      loadHosts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(host: ProxyHost) {
    await fetch(`/api/npm/hosts/${host.id}/enable`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !host.enabled }),
    });
    loadHosts();
  }

  async function removeHost(host: ProxyHost) {
    if (!confirm(`Supprimer la redirection pour ${host.domainNames.join(", ")} ?`)) return;
    await fetch(`/api/npm/hosts/${host.id}`, { method: "DELETE" });
    loadHosts();
  }

  async function renewCert(host: ProxyHost) {
    if (!host.certificateId) return;
    setRenewing(host.certificateId);
    setError("");
    try {
      const res = await fetch(`/api/npm/certificates/${host.certificateId}/renew`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setRenewing(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Reverse proxy (Nginx Proxy Manager)</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Ajoute, modifie ou supprime les redirections de domaines sans passer par l&apos;interface NPM.
          </p>
        </div>
        <button
          onClick={() => setShowConfig((s) => !s)}
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
        >
          {configured ? "Reconfigurer" : "Configurer"}
        </button>
      </div>

      {showConfig && (
        <div className="max-w-md space-y-3 rounded border border-neutral-800 bg-neutral-900 p-4">
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">URL de Nginx Proxy Manager</span>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://ip-vps:81" className={INPUT_CLASS} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Email administrateur</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT_CLASS} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">{hasPassword ? "Mot de passe (déjà défini)" : "Mot de passe"}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={hasPassword ? "laisser vide pour garder" : ""}
              className={INPUT_CLASS}
            />
          </label>
          <button onClick={saveConfig} className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-900/60">
            Enregistrer
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {configured && (
        <>
          <button
            onClick={() => setShowCreate((s) => !s)}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
          >
            {showCreate ? "Annuler" : "+ Nouvelle redirection"}
          </button>

          {showCreate && (
            <div className="grid max-w-2xl grid-cols-2 gap-3 rounded border border-neutral-800 bg-neutral-900 p-4">
              <label className="col-span-2 block">
                <span className="mb-1 block text-xs text-neutral-400">Domaine(s), séparés par des virgules</span>
                <input
                  value={form.domainNames}
                  onChange={(e) => setForm({ ...form, domainNames: e.target.value })}
                  placeholder="app.abhd.fr"
                  className={INPUT_CLASS}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-400">Protocole vers la cible</span>
                <select
                  value={form.forwardScheme}
                  onChange={(e) => setForm({ ...form, forwardScheme: e.target.value as "http" | "https" })}
                  className={INPUT_CLASS}
                >
                  <option value="http">http</option>
                  <option value="https">https</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-400">Hôte cible (IP ou nom)</span>
                <input value={form.forwardHost} onChange={(e) => setForm({ ...form, forwardHost: e.target.value })} className={INPUT_CLASS} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-400">Port cible</span>
                <input
                  type="number"
                  value={form.forwardPort}
                  onChange={(e) => setForm({ ...form, forwardPort: Number(e.target.value) })}
                  className={INPUT_CLASS}
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-neutral-300">
                <input type="checkbox" checked={form.sslForced} onChange={(e) => setForm({ ...form, sslForced: e.target.checked })} />
                Forcer HTTPS
              </label>
              <div className="col-span-2 flex justify-end">
                <button
                  onClick={createHost}
                  disabled={saving}
                  className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-900/60 disabled:opacity-50"
                >
                  {saving ? "Création..." : "Créer"}
                </button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900 text-left text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Domaine(s)</th>
                  <th className="px-3 py-2 font-medium">Cible</th>
                  <th className="px-3 py-2 font-medium">HTTPS forcé</th>
                  <th className="px-3 py-2 font-medium">Statut</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {hosts?.map((h) => (
                  <tr key={h.id} className="border-t border-neutral-900">
                    <td className="px-3 py-2 text-neutral-200">{h.domainNames.join(", ")}</td>
                    <td className="px-3 py-2 font-mono text-xs text-neutral-400">
                      {h.forwardScheme}://{h.forwardHost}:{h.forwardPort}
                    </td>
                    <td className="px-3 py-2">{h.sslForced ? "✅" : "—"}</td>
                    <td className="px-3 py-2">
                      <span className={h.enabled ? "text-emerald-400" : "text-neutral-500"}>
                        {h.enabled ? "Actif" : "Désactivé"}
                      </span>
                    </td>
                    <td className="space-x-2 px-3 py-2">
                      <button
                        onClick={() => toggleEnabled(h)}
                        className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800"
                      >
                        {h.enabled ? "Désactiver" : "Activer"}
                      </button>
                      {!!h.certificateId && (
                        <button
                          onClick={() => renewCert(h)}
                          disabled={renewing === h.certificateId}
                          className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800 disabled:opacity-50"
                        >
                          {renewing === h.certificateId ? "Renouvellement..." : "Renouveler le certificat"}
                        </button>
                      )}
                      <button
                        onClick={() => removeHost(h)}
                        className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-red-400 hover:bg-neutral-800"
                      >
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
                {hosts?.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-neutral-600">
                      Aucune redirection configurée.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
