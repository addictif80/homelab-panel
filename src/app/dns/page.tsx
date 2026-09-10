"use client";

import { useCallback, useEffect, useState } from "react";

type DnsRecord = { id: string; type: string; name: string; content: string; ttl: number; proxied?: boolean };
type DnsZone = { id: string; provider: string; label: string; config: Record<string, string> };
type ProviderField = { key: string; label: string; placeholder?: string; secret?: boolean };
type ProviderMeta = { id: string; name: string; helpText: string; configFields: ProviderField[]; secretFields: ProviderField[] };

const RECORD_TYPES = ["A", "AAAA", "CNAME", "TXT", "MX", "NS"];
const EMPTY_RECORD_FORM = { type: "A", name: "", content: "", ttl: 3600, proxied: false };

export default function DnsPage() {
  const [providers, setProviders] = useState<ProviderMeta[]>([]);
  const [zones, setZones] = useState<DnsZone[]>([]);
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);

  const [showAddZone, setShowAddZone] = useState(false);
  const [newProviderId, setNewProviderId] = useState<string>("cloudflare");
  const [newLabel, setNewLabel] = useState("");
  const [newConfig, setNewConfig] = useState<Record<string, string>>({});
  const [newSecret, setNewSecret] = useState<Record<string, string>>({});
  const [savingZone, setSavingZone] = useState(false);

  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState(EMPTY_RECORD_FORM);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const loadZones = useCallback(async () => {
    const res = await fetch("/api/settings/dns");
    const data = await res.json();
    setProviders(data.providers);
    setZones(data.zones);
    if (data.zones.length > 0 && !activeZoneId) setActiveZoneId(data.zones[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRecords = useCallback(async (zoneId: string) => {
    setLoadingRecords(true);
    setError("");
    try {
      const res = await fetch(`/api/dns/${zoneId}/records`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRecords(data.records);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoadingRecords(false);
    }
  }, []);

  useEffect(() => {
    loadZones();
  }, [loadZones]);

  useEffect(() => {
    if (activeZoneId) loadRecords(activeZoneId);
  }, [activeZoneId, loadRecords]);

  const activeZone = zones.find((z) => z.id === activeZoneId) ?? null;
  const newProviderMeta = providers.find((p) => p.id === newProviderId);

  async function testConnection() {
    if (!activeZoneId) return;
    setTesting(true);
    setError("");
    try {
      const res = await fetch(`/api/settings/dns/${activeZoneId}/test`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      alert("Connexion réussie.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setTesting(false);
    }
  }

  async function addZone(e: React.FormEvent) {
    e.preventDefault();
    setSavingZone(true);
    setError("");
    try {
      const res = await fetch("/api/settings/dns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: newProviderId, label: newLabel, config: newConfig, secret: newSecret }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowAddZone(false);
      setNewLabel("");
      setNewConfig({});
      setNewSecret({});
      setActiveZoneId(data.zone.id);
      loadZones();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSavingZone(false);
    }
  }

  async function removeZone(zone: DnsZone) {
    if (!confirm(`Retirer la zone « ${zone.label} » du panel ? Les enregistrements DNS eux-mêmes ne sont pas supprimés.`))
      return;
    await fetch(`/api/settings/dns/${zone.id}`, { method: "DELETE" });
    setActiveZoneId(null);
    loadZones();
  }

  function openCreate() {
    setForm(EMPTY_RECORD_FORM);
    setEditingId("new");
  }

  function openEdit(r: DnsRecord) {
    setForm({ type: r.type, name: r.name, content: r.content, ttl: r.ttl, proxied: !!r.proxied });
    setEditingId(r.id);
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!activeZoneId) return;
    setSaving(true);
    setError("");
    try {
      const res =
        editingId === "new"
          ? await fetch(`/api/dns/${activeZoneId}/records`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(form),
            })
          : await fetch(`/api/dns/${activeZoneId}/records/${editingId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(form),
            });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEditingId(null);
      loadRecords(activeZoneId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecordRow(r: DnsRecord) {
    if (!activeZoneId) return;
    if (!confirm(`Supprimer l'enregistrement ${r.type} ${r.name} ?`)) return;
    try {
      const res = await fetch(`/api/dns/${activeZoneId}/records/${r.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      loadRecords(activeZoneId);
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
            Gère les enregistrements DNS de tes domaines, quel que soit le registrar ou l&apos;hébergeur DNS.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeZoneId && (
            <button
              onClick={openCreate}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500"
            >
              + Ajouter un enregistrement
            </button>
          )}
          <button
            onClick={() => setShowAddZone((s) => !s)}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800"
          >
            + Ajouter un domaine
          </button>
        </div>
      </div>

      {zones.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {zones.map((z) => {
            const meta = providers.find((p) => p.id === z.provider);
            return (
              <button
                key={z.id}
                onClick={() => setActiveZoneId(z.id)}
                className={`rounded border px-3 py-1 text-sm ${
                  activeZoneId === z.id
                    ? "border-blue-600 bg-blue-900/30 text-blue-200"
                    : "border-neutral-700 text-neutral-400 hover:bg-neutral-800"
                }`}
              >
                {z.label} <span className="text-xs text-neutral-500">({meta?.name ?? z.provider})</span>
              </button>
            );
          })}
        </div>
      )}

      {showAddZone && (
        <form onSubmit={addZone} className="max-w-md space-y-3 rounded border border-neutral-800 p-4">
          <div>
            <label className="mb-1 block text-xs text-neutral-400">Fournisseur DNS</label>
            <select
              value={newProviderId}
              onChange={(e) => {
                setNewProviderId(e.target.value);
                setNewConfig({});
                setNewSecret({});
              }}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {newProviderMeta && <p className="text-xs text-neutral-400">{newProviderMeta.helpText}</p>}
          <div>
            <label className="mb-1 block text-xs text-neutral-400">Nom (repère dans le panel)</label>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="exemple.fr"
              required
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
            />
          </div>
          {newProviderMeta?.configFields.map((f) => (
            <div key={f.key}>
              <label className="mb-1 block text-xs text-neutral-400">{f.label}</label>
              <input
                value={newConfig[f.key] ?? ""}
                onChange={(e) => setNewConfig({ ...newConfig, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                required
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              />
            </div>
          ))}
          {newProviderMeta?.secretFields.map((f) => (
            <div key={f.key}>
              <label className="mb-1 block text-xs text-neutral-400">{f.label}</label>
              <input
                type="password"
                value={newSecret[f.key] ?? ""}
                onChange={(e) => setNewSecret({ ...newSecret, [f.key]: e.target.value })}
                required
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              />
            </div>
          ))}
          <button
            type="submit"
            disabled={savingZone}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            {savingZone ? "Enregistrement..." : "Ajouter ce domaine"}
          </button>
        </form>
      )}

      {editingId && activeZone && (
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
              <span className="mb-1 block text-xs text-neutral-400">TTL (secondes)</span>
              <input
                type="number"
                value={form.ttl}
                onChange={(e) => setForm({ ...form, ttl: Number(e.target.value) })}
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              />
            </label>
          </div>
          {activeZone.provider === "cloudflare" && (
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={form.proxied}
                onChange={(e) => setForm({ ...form, proxied: e.target.checked })}
              />
              Proxifié par Cloudflare (masque l&apos;IP réelle, cache/WAF)
            </label>
          )}
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

      {zones.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Aucun domaine configuré. Clique sur &laquo; Ajouter un domaine &raquo; et choisis ton registrar ou
          hébergeur DNS (Cloudflare, OVH, Gandi, Namecheap).
        </p>
      ) : activeZone ? (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs text-neutral-500">
              {activeZone.label} — {providers.find((p) => p.id === activeZone.provider)?.name}
            </p>
            <div className="flex gap-2">
              <button
                onClick={testConnection}
                disabled={testing}
                className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800 disabled:opacity-50"
              >
                {testing ? "Test..." : "Tester la connexion"}
              </button>
              <button
                onClick={() => removeZone(activeZone)}
                className="rounded border border-neutral-700 px-2 py-1 text-xs text-red-400 hover:bg-neutral-800"
              >
                Retirer ce domaine
              </button>
            </div>
          </div>

          {loadingRecords ? (
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
                    <th className="px-3 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id} className="border-t border-neutral-800">
                      <td className="px-3 py-2 font-medium">{r.type}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.name}</td>
                      <td className="max-w-xs truncate px-3 py-2 font-mono text-xs text-neutral-400" title={r.content}>
                        {r.content} {r.proxied && <span className="text-amber-400">(proxifié)</span>}
                      </td>
                      <td className="px-3 py-2 text-neutral-400">{r.ttl === 1 ? "Auto" : r.ttl}</td>
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
                  {records.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-neutral-600">
                        Aucun enregistrement.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
