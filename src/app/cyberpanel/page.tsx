"use client";

import { useEffect, useState } from "react";

type Website = { domain: string; adminEmail?: string; state?: string; package?: string };

const INPUT_CLASS = "w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100";
const EMPTY_FORM = { domain: "", username: "", password: "", email: "", packageName: "Default" };

export default function CyberPanelPage() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [adminUser, setAdminUser] = useState("admin");
  const [password, setPassword] = useState("");
  const [hasPassword, setHasPassword] = useState(false);
  const [verifySsl, setVerifySsl] = useState(false);

  const [websites, setWebsites] = useState<Website[] | null>(null);
  const [packages, setPackages] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  function loadConfig() {
    fetch("/api/settings/cyberpanel")
      .then((r) => r.json())
      .then((d) => {
        setConfigured(!!d.config);
        if (d.config) {
          setBaseUrl(d.config.baseUrl);
          setAdminUser(d.config.adminUser);
          setVerifySsl(!!d.config.verifySsl);
        }
        setHasPassword(d.hasPassword);
      });
  }

  function loadWebsites() {
    setError("");
    fetch("/api/cyberpanel/websites")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setWebsites(d.websites);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Erreur."));
  }

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    if (configured) {
      loadWebsites();
      fetch("/api/cyberpanel/packages")
        .then((r) => r.json())
        .then((d) => setPackages(d.packages || []));
    }
  }, [configured]);

  async function saveConfig() {
    setError("");
    const res = await fetch("/api/settings/cyberpanel", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl, adminUser, password: password || undefined, verifySsl }),
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

  async function createWebsite() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/cyberpanel/websites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setForm(EMPTY_FORM);
      setShowCreate(false);
      loadWebsites();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setSaving(false);
    }
  }

  async function removeWebsite(domain: string) {
    if (!confirm(`Supprimer le site ${domain} (compte, fichiers, base de données) ?`)) return;
    await fetch(`/api/cyberpanel/websites?domain=${encodeURIComponent(domain)}`, { method: "DELETE" });
    loadWebsites();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">CyberPanel</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Crée, consulte et supprime des sites CyberPanel (hébergement web) sans passer par son interface séparée.
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
            <span className="mb-1 block text-xs text-neutral-400">URL de CyberPanel</span>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://ip-serveur:8090" className={INPUT_CLASS} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Utilisateur admin</span>
            <input value={adminUser} onChange={(e) => setAdminUser(e.target.value)} className={INPUT_CLASS} />
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
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input type="checkbox" checked={verifySsl} onChange={(e) => setVerifySsl(e.target.checked)} />
            Vérifier le certificat TLS
          </label>
          <p className="text-xs text-neutral-500">
            CyberPanel utilise un certificat auto-signé par défaut sur son port d&apos;administration (8090) — laisse
            cette case décochée sauf si tu as installé un vrai certificat dessus, sinon la connexion échouera.
          </p>
          <button onClick={saveConfig} className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-900/60">
            Enregistrer et tester la connexion
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
            {showCreate ? "Annuler" : "+ Nouveau site"}
          </button>

          {showCreate && (
            <div className="grid max-w-2xl grid-cols-2 gap-3 rounded border border-neutral-800 bg-neutral-900 p-4">
              <label className="col-span-2 block">
                <span className="mb-1 block text-xs text-neutral-400">Domaine</span>
                <input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="site.exemple.fr" className={INPUT_CLASS} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-400">Utilisateur (propriétaire)</span>
                <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className={INPUT_CLASS} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-400">Mot de passe</span>
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={INPUT_CLASS} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-400">Email</span>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={INPUT_CLASS} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-400">Package</span>
                <select value={form.packageName} onChange={(e) => setForm({ ...form, packageName: e.target.value })} className={INPUT_CLASS}>
                  {["Default", ...packages.filter((p) => p !== "Default")].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <div className="col-span-2 flex justify-end">
                <button
                  onClick={createWebsite}
                  disabled={saving}
                  className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-900/60 disabled:opacity-50"
                >
                  {saving ? "Création..." : "Créer le site"}
                </button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900 text-left text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Domaine</th>
                  <th className="px-3 py-2 font-medium">Package</th>
                  <th className="px-3 py-2 font-medium">Statut</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {websites?.map((w) => (
                  <tr key={w.domain} className="border-t border-neutral-900">
                    <td className="px-3 py-2 text-neutral-200">{w.domain}</td>
                    <td className="px-3 py-2 text-neutral-400">{w.package || "—"}</td>
                    <td className="px-3 py-2 text-neutral-400">{w.state || "—"}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => removeWebsite(w.domain)}
                        className="rounded border border-red-900 px-2 py-0.5 text-xs text-red-300 hover:bg-red-950/40"
                      >
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
                {websites?.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-neutral-600">
                      Aucun site sur ce CyberPanel.
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
