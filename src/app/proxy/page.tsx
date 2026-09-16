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
  advancedConfig: string;
};

type FailoverConfig = {
  proxyHostId: number;
  mode: "server" | "page";
  backupScheme: "http" | "https";
  backupHost: string;
  backupPort: number;
  backupPath: string;
  maintenanceHtml: string | null;
  enabled: boolean;
  lastStatus: "unknown" | "primary" | "failover" | "error";
  lastCheckedAt: string | null;
  lastError: string | null;
};

const DEFAULT_MAINTENANCE_HTML = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Service temporairement indisponible</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #e5e5e5; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
  div { max-width: 32rem; padding: 2rem; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  p { color: #a3a3a3; }
</style>
</head>
<body>
<div>
  <h1>Service momentanément inaccessible</h1>
  <p>Nous travaillons à le rétablir au plus vite. Merci de réessayer dans quelques minutes.</p>
</div>
</body>
</html>`;

type Certificate = {
  id: number;
  niceName: string;
  domainNames: string[];
  provider: "letsencrypt" | "other";
  expiresOn: string | null;
};

const INPUT_CLASS = "w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100";

const EMPTY_FORM = {
  domainNames: "",
  forwardScheme: "http" as "http" | "https",
  forwardHost: "",
  forwardPort: 80,
  sslForced: false,
  certificateId: null as number | null,
};

function CertificateSelect({
  value,
  onChange,
  certificates,
}: {
  value: number | null;
  onChange: (id: number | null) => void;
  certificates: Certificate[];
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className={INPUT_CLASS}
    >
      <option value="">Aucun (pas de HTTPS, ou nouveau certificat via NPM)</option>
      {certificates.map((c) => (
        <option key={c.id} value={c.id}>
          {c.niceName || c.domainNames.join(", ")}
          {c.provider === "letsencrypt" ? " (Let's Encrypt)" : " (personnalisé)"}
          {c.expiresOn ? ` — expire le ${new Date(c.expiresOn).toLocaleDateString("fr-FR")}` : ""}
        </option>
      ))}
    </select>
  );
}

export default function ProxyPage() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [hasPassword, setHasPassword] = useState(false);

  const [hosts, setHosts] = useState<ProxyHost[] | null>(null);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [renewing, setRenewing] = useState<number | null>(null);
  const [detailHost, setDetailHost] = useState<ProxyHost | null>(null);
  const [detailForm, setDetailForm] = useState(EMPTY_FORM);
  const [detailAdvanced, setDetailAdvanced] = useState("");
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [failover, setFailover] = useState<FailoverConfig | null>(null);
  const [failoverForm, setFailoverForm] = useState({
    mode: "server" as "server" | "page",
    scheme: "http" as "http" | "https",
    host: "",
    port: 80,
    path: "/",
    html: DEFAULT_MAINTENANCE_HTML,
  });
  const [failoverBusy, setFailoverBusy] = useState(false);

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

  function loadCertificates() {
    fetch("/api/npm/certificates")
      .then((r) => r.json())
      .then((d) => setCertificates(d.certificates ?? []))
      .catch(() => {});
  }

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    if (configured) {
      loadHosts();
      loadCertificates();
    }
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
          certificateId: form.certificateId,
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

  async function openDetail(host: ProxyHost) {
    setDetailError("");
    setDetailHost(host);
    setDetailForm({
      domainNames: host.domainNames.join(", "),
      forwardScheme: host.forwardScheme,
      forwardHost: host.forwardHost,
      forwardPort: host.forwardPort,
      sslForced: host.sslForced,
      certificateId: host.certificateId,
    });
    setDetailAdvanced(host.advancedConfig);
    setFailover(null);
    try {
      const [freshRes, failoverRes] = await Promise.all([
        fetch(`/api/npm/hosts/${host.id}`),
        fetch(`/api/npm/hosts/${host.id}/failover`),
      ]);
      const freshData = await freshRes.json();
      if (freshRes.ok) {
        setDetailHost(freshData.host);
        setDetailForm({
          domainNames: freshData.host.domainNames.join(", "),
          forwardScheme: freshData.host.forwardScheme,
          forwardHost: freshData.host.forwardHost,
          forwardPort: freshData.host.forwardPort,
          sslForced: freshData.host.sslForced,
          certificateId: freshData.host.certificateId,
        });
        setDetailAdvanced(freshData.host.advancedConfig);
      }
      const failoverData = await failoverRes.json();
      setFailover(failoverData.failover);
      if (failoverData.failover) {
        setFailoverForm({
          mode: failoverData.failover.mode,
          scheme: failoverData.failover.backupScheme,
          host: failoverData.failover.backupHost,
          port: failoverData.failover.backupPort,
          path: failoverData.failover.backupPath || "/",
          html: failoverData.failover.maintenanceHtml || DEFAULT_MAINTENANCE_HTML,
        });
      } else {
        setFailoverForm({ mode: "server", scheme: "http", host: "", port: 80, path: "/", html: DEFAULT_MAINTENANCE_HTML });
      }
    } catch {
      // keep the list's own (slightly less fresh) copy as a fallback
    }
  }

  async function saveDetail() {
    if (!detailHost) return;
    setDetailSaving(true);
    setDetailError("");
    try {
      const res = await fetch(`/api/npm/hosts/${detailHost.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domainNames: detailForm.domainNames.split(",").map((d) => d.trim()).filter(Boolean),
          forwardScheme: detailForm.forwardScheme,
          forwardHost: detailForm.forwardHost,
          forwardPort: Number(detailForm.forwardPort),
          sslForced: detailForm.sslForced,
          certificateId: detailForm.certificateId,
          advancedConfig: detailAdvanced,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDetailHost(null);
      loadHosts();
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setDetailSaving(false);
    }
  }

  async function saveFailover() {
    if (!detailHost) return;
    setFailoverBusy(true);
    setDetailError("");
    try {
      const res = await fetch(`/api/npm/hosts/${detailHost.id}/failover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(failoverForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFailover(data.failover);
      openDetail(detailHost); // refresh advancedConfig preview to reflect the injected snippet
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setFailoverBusy(false);
    }
  }

  async function removeFailoverConfig() {
    if (!detailHost) return;
    if (!confirm("Supprimer le failover pour cette redirection ?")) return;
    setFailoverBusy(true);
    setDetailError("");
    try {
      const res = await fetch(`/api/npm/hosts/${detailHost.id}/failover`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFailover(null);
      openDetail(detailHost);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setFailoverBusy(false);
    }
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
                  placeholder="app.exemple.fr"
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
              <label className="col-span-2 block">
                <span className="mb-1 block text-xs text-neutral-400">Certificat SSL</span>
                <CertificateSelect
                  value={form.certificateId}
                  onChange={(id) => setForm({ ...form, certificateId: id })}
                  certificates={certificates}
                />
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
                        onClick={() => openDetail(h)}
                        className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800"
                      >
                        Consulter
                      </button>
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

      {detailHost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setDetailHost(null)}>
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded border border-neutral-800 bg-neutral-900 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-neutral-100">{detailHost.domainNames.join(", ")}</h2>
              <button onClick={() => setDetailHost(null)} className="text-neutral-400 hover:text-neutral-200">
                ✕
              </button>
            </div>

            {detailError && <p className="mb-3 text-sm text-red-400">{detailError}</p>}

            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-400">Domaine(s), séparés par des virgules</span>
                <input
                  value={detailForm.domainNames}
                  onChange={(e) => setDetailForm({ ...detailForm, domainNames: e.target.value })}
                  className={INPUT_CLASS}
                />
              </label>
              <div className="grid grid-cols-3 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs text-neutral-400">Protocole</span>
                  <select
                    value={detailForm.forwardScheme}
                    onChange={(e) => setDetailForm({ ...detailForm, forwardScheme: e.target.value as "http" | "https" })}
                    className={INPUT_CLASS}
                  >
                    <option value="http">http</option>
                    <option value="https">https</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-neutral-400">Hôte cible</span>
                  <input
                    value={detailForm.forwardHost}
                    onChange={(e) => setDetailForm({ ...detailForm, forwardHost: e.target.value })}
                    className={INPUT_CLASS}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-neutral-400">Port cible</span>
                  <input
                    type="number"
                    value={detailForm.forwardPort}
                    onChange={(e) => setDetailForm({ ...detailForm, forwardPort: Number(e.target.value) })}
                    className={INPUT_CLASS}
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm text-neutral-300">
                <input
                  type="checkbox"
                  checked={detailForm.sslForced}
                  onChange={(e) => setDetailForm({ ...detailForm, sslForced: e.target.checked })}
                />
                Forcer HTTPS
              </label>

              <label className="block">
                <span className="mb-1 block text-xs text-neutral-400">Certificat SSL</span>
                <CertificateSelect
                  value={detailForm.certificateId}
                  onChange={(id) => setDetailForm({ ...detailForm, certificateId: id })}
                  certificates={certificates}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs text-neutral-400">
                  Configuration avancée (onglet &quot;Advanced&quot; de NPM) — inclut le bloc de failover ci-dessous si activé
                </span>
                <textarea
                  value={detailAdvanced}
                  onChange={(e) => setDetailAdvanced(e.target.value)}
                  rows={8}
                  spellCheck={false}
                  className={`${INPUT_CLASS} font-mono text-xs`}
                />
              </label>

              <button
                onClick={saveDetail}
                disabled={detailSaving}
                className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-900/60 disabled:opacity-50"
              >
                {detailSaving ? "Enregistrement..." : "Enregistrer"}
              </button>
            </div>

            <div className="mt-6 space-y-3 border-t border-neutral-800 pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-neutral-100">Failover</h3>
                {failover && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      failover.lastStatus === "primary"
                        ? "bg-emerald-900/40 text-emerald-300"
                        : failover.lastStatus === "failover"
                          ? "bg-amber-900/40 text-amber-300"
                          : failover.lastStatus === "error"
                            ? "bg-red-900/40 text-red-300"
                            : "bg-neutral-800 text-neutral-400"
                    }`}
                  >
                    {failover.lastStatus === "primary"
                      ? "Inactif (primaire OK)"
                      : failover.lastStatus === "failover"
                        ? `Actif vers ${failover.mode === "page" ? "la page de maintenance" : `${failover.backupScheme}://${failover.backupHost}:${failover.backupPort}${failover.backupPath}`}`
                        : failover.lastStatus === "error"
                          ? "Primaire et secours injoignables"
                          : "Statut inconnu"}
                  </span>
                )}
              </div>
              <p className="text-xs text-neutral-500">
                Ajoute un bloc nginx dans la config avancée : si la cible principale répond en erreur (502/503/504),
                nginx bascule automatiquement et immédiatement, sans intervention du panel. Une vérification
                périodique (badge ci-dessus) affiche juste l&apos;état actuel.
                {failover?.lastCheckedAt && ` Dernière vérification : ${new Date(`${failover.lastCheckedAt}Z`).toLocaleString("fr-FR")}.`}
              </p>

              <div className="flex gap-1.5 text-xs">
                <button
                  onClick={() => setFailoverForm({ ...failoverForm, mode: "server" })}
                  className={`rounded border px-2 py-1 ${failoverForm.mode === "server" ? "border-blue-700 bg-blue-900/40 text-blue-200" : "border-neutral-700 text-neutral-400 hover:bg-neutral-800"}`}
                >
                  Serveur de secours
                </button>
                <button
                  onClick={() => setFailoverForm({ ...failoverForm, mode: "page" })}
                  className={`rounded border px-2 py-1 ${failoverForm.mode === "page" ? "border-blue-700 bg-blue-900/40 text-blue-200" : "border-neutral-700 text-neutral-400 hover:bg-neutral-800"}`}
                >
                  Page de maintenance personnalisée
                </button>
              </div>

              {failoverForm.mode === "server" ? (
                <div className="grid grid-cols-4 gap-3">
                  <label className="block">
                    <span className="mb-1 block text-xs text-neutral-400">Protocole</span>
                    <select
                      value={failoverForm.scheme}
                      onChange={(e) => setFailoverForm({ ...failoverForm, scheme: e.target.value as "http" | "https" })}
                      className={INPUT_CLASS}
                    >
                      <option value="http">http</option>
                      <option value="https">https</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-neutral-400">Hôte de secours</span>
                    <input
                      value={failoverForm.host}
                      onChange={(e) => setFailoverForm({ ...failoverForm, host: e.target.value })}
                      placeholder="IP ou nom"
                      className={INPUT_CLASS}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-neutral-400">Port de secours</span>
                    <input
                      type="number"
                      value={failoverForm.port}
                      onChange={(e) => setFailoverForm({ ...failoverForm, port: Number(e.target.value) })}
                      className={INPUT_CLASS}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-neutral-400">Chemin (optionnel)</span>
                    <input
                      value={failoverForm.path}
                      onChange={(e) => setFailoverForm({ ...failoverForm, path: e.target.value })}
                      placeholder="/file.html"
                      className={INPUT_CLASS}
                    />
                  </label>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-neutral-400">
                      Page HTML affichée aux visiteurs quand le service principal est indisponible (ex : une page
                      &quot;mailcow.html&quot; personnalisée pour cette instance)
                    </span>
                    <label className="cursor-pointer rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800">
                      Importer un fichier .html
                      <input
                        type="file"
                        accept=".html,text/html"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (!file) return;
                          const text = await file.text();
                          setFailoverForm((f) => ({ ...f, html: text }));
                        }}
                      />
                    </label>
                  </div>
                  <textarea
                    value={failoverForm.html}
                    onChange={(e) => setFailoverForm({ ...failoverForm, html: e.target.value })}
                    rows={10}
                    spellCheck={false}
                    className={`${INPUT_CLASS} font-mono text-xs`}
                  />
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={saveFailover}
                  disabled={failoverBusy || (failoverForm.mode === "server" ? !failoverForm.host.trim() : !failoverForm.html.trim())}
                  className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-900/60 disabled:opacity-50"
                >
                  {failoverBusy ? "..." : failover ? "Mettre à jour" : "Activer le failover"}
                </button>
                {failover && (
                  <button
                    onClick={removeFailoverConfig}
                    disabled={failoverBusy}
                    className="rounded border border-red-900 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950/40 disabled:opacity-50"
                  >
                    Désactiver
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
