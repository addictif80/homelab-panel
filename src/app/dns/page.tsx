"use client";

import { useCallback, useEffect, useState } from "react";

type DnsRecord = { id: string; type: string; name: string; content: string; ttl: number; proxied: boolean };
type DnsConfig = { zoneId: string; zoneName: string };

const RECORD_TYPES = ["A", "AAAA", "CNAME", "TXT", "MX", "NS"];

const EMPTY_FORM = { type: "A", name: "", content: "", ttl: 1, proxied: false };

export default function DnsPage() {
  const [config, setConfig] = useState<DnsConfig | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [zoneId, setZoneId] = useState("");
  const [zoneName, setZoneName] = useState("");
  const [token, setToken] = useState("");

  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const loadConfig = useCallback(async () => {
    const res = await fetch("/api/settings/dns");
    const data = await res.json();
    setConfig(data.config);
    setHasToken(data.hasToken);
    if (data.config) {
      setZoneId(data.config.zoneId);
      setZoneName(data.config.zoneName);
    }
  }, []);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/dns/records");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRecords(data.records);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (config && hasToken) loadRecords();
  }, [config, hasToken, loadRecords]);

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const res = await fetch("/api/settings/dns", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zoneId, zoneName, token: token || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setToken("");
      setShowConfig(false);
      loadConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditingId("new");
  }

  function openEdit(r: DnsRecord) {
    setForm({ type: r.type, name: r.name, content: r.content, ttl: r.ttl, proxied: r.proxied });
    setEditingId(r.id);
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res =
        editingId === "new"
          ? await fetch("/api/dns/records", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(form),
            })
          : await fetch(`/api/dns/records/${editingId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(form),
            });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEditingId(null);
      loadRecords();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecordRow(r: DnsRecord) {
    if (!confirm(`Supprimer l'enregistrement ${r.type} ${r.name} ?`)) return;
    try {
      const res = await fetch(`/api/dns/records/${r.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      loadRecords();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">DNS</h1>
          <p className="text-sm text-neutral-400">
            Gère les enregistrements DNS d&apos;une zone Cloudflare directement depuis le panel.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {config && hasToken && (
            <button
              onClick={openCreate}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500"
            >
              + Ajouter un enregistrement
            </button>
          )}
          <button
            onClick={() => setShowConfig((s) => !s)}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800"
          >
            Configurer Cloudflare
          </button>
        </div>
      </div>

      {showConfig && (
        <form onSubmit={saveConfig} className="max-w-md space-y-3 rounded border border-neutral-800 p-4">
          <p className="text-xs text-neutral-400">
            Crée un token API sur Cloudflare (My Profile → API Tokens) avec la permission « Zone.DNS: Edit » sur la
            zone concernée.
          </p>
          <div>
            <label className="mb-1 block text-xs text-neutral-400">Zone ID</label>
            <input
              value={zoneId}
              onChange={(e) => setZoneId(e.target.value)}
              placeholder="ex: a1b2c3d4..."
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-400">Nom de domaine</label>
            <input
              value={zoneName}
              onChange={(e) => setZoneName(e.target.value)}
              placeholder="exemple.fr"
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-400">
              {hasToken ? "Token API (déjà défini)" : "Token API"}
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={hasToken ? "•••••••• (laisser vide pour garder)" : ""}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
            />
          </div>
          <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500">
            Enregistrer
          </button>
        </form>
      )}

      {editingId && (
        <form onSubmit={submitForm} className="max-w-2xl space-y-3 rounded border border-neutral-800 p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-400">Type</span>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              >
                {RECORD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-400">Nom</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="sub.exemple.fr ou @"
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-400">Contenu</span>
              <input
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="203.0.113.10"
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-400">TTL (1 = auto)</span>
              <input
                type="number"
                value={form.ttl}
                onChange={(e) => setForm({ ...form, ttl: Number(e.target.value) })}
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={form.proxied}
              onChange={(e) => setForm({ ...form, proxied: e.target.checked })}
            />
            Proxifié par Cloudflare (masque l&apos;IP réelle, cache/WAF)
          </label>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
            >
              {saving ? "Enregistrement..." : "Enregistrer"}
            </button>
            <button
              type="button"
              onClick={() => setEditingId(null)}
              className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800"
            >
              Annuler
            </button>
          </div>
        </form>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {!config || !hasToken ? (
        <p className="text-sm text-neutral-500">
          Aucune zone Cloudflare configurée. Clique sur &laquo; Configurer Cloudflare &raquo;.
        </p>
      ) : loading ? (
        <p className="text-sm text-neutral-500">Chargement...</p>
      ) : (
        <div className="overflow-auto rounded border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-left text-neutral-400">
              <tr>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Nom</th>
                <th className="px-3 py-2 font-medium">Contenu</th>
                <th className="px-3 py-2 font-medium">TTL</th>
                <th className="px-3 py-2 font-medium">Proxifié</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="border-t border-neutral-800">
                  <td className="px-3 py-2 font-medium">{r.type}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.name}</td>
                  <td className="px-3 py-2 font-mono text-xs text-neutral-400">{r.content}</td>
                  <td className="px-3 py-2 text-neutral-400">{r.ttl === 1 ? "Auto" : r.ttl}</td>
                  <td className="px-3 py-2 text-neutral-400">{r.proxied ? "Oui" : "Non"}</td>
                  <td className="px-3 py-2 space-x-2">
                    <button
                      onClick={() => openEdit(r)}
                      className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800"
                    >
                      Modifier
                    </button>
                    <button
                      onClick={() => deleteRecordRow(r)}
                      className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-red-400 hover:bg-neutral-800"
                    >
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
