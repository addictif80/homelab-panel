"use client";

import { useCallback, useEffect, useState } from "react";

type Host = { id: number; name: string };
type Kind = "folder" | "mysql" | "postgres" | "sqlite";
type Replication = {
  id: string;
  name: string;
  kind: Kind;
  sourceHostId: number;
  targetHostId: number;
  sourcePath: string;
  targetPath: string;
  dbPort: number | null;
  dbUser: string | null;
  enabled: boolean;
  status: "unknown" | "setting_up" | "in_sync" | "lagging" | "error" | "stopped";
  statusDetail: string | null;
  lastCheckedAt: string | null;
  lastSyncedAt: string | null;
};

const KIND_LABELS: Record<Kind, string> = {
  folder: "Dossier (lsyncd, continu)",
  mysql: "MySQL / MariaDB (réplication native)",
  postgres: "PostgreSQL (réplication native)",
  sqlite: "SQLite (copie périodique)",
};

const STATUS_STYLES: Record<Replication["status"], string> = {
  unknown: "bg-neutral-800 text-neutral-400",
  setting_up: "bg-blue-950/50 text-blue-300",
  in_sync: "bg-emerald-950/50 text-emerald-300",
  lagging: "bg-amber-950/50 text-amber-300",
  error: "bg-red-950/50 text-red-300",
  stopped: "bg-neutral-800 text-neutral-400",
};

const STATUS_LABELS: Record<Replication["status"], string> = {
  unknown: "Inconnu",
  setting_up: "Configuration…",
  in_sync: "Synchronisé",
  lagging: "En retard",
  error: "Erreur",
  stopped: "Arrêté",
};

const EMPTY_FORM = {
  name: "",
  kind: "folder" as Kind,
  sourceHostId: "" as number | "",
  targetHostId: "" as number | "",
  sourcePath: "",
  targetPath: "",
  dbPort: "",
  dbUser: "",
  dbPassword: "",
};

export default function HaPage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [replications, setReplications] = useState<Replication[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [hostsRes, replRes] = await Promise.all([fetch("/api/hosts"), fetch("/api/ha/replications")]);
    const hostsData = await hostsRes.json();
    const replData = await replRes.json();
    setHosts(hostsData.hosts ?? hostsData ?? []);
    setReplications(replData.replications ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Live-ish view during setup: a replication mid-setup updates its own status/statusDetail at
  // each step, so poll while at least one is in that state instead of leaving the page stale.
  useEffect(() => {
    if (!replications.some((r) => r.status === "setting_up")) return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [replications, load]);

  function hostName(id: number) {
    return hosts.find((h) => h.id === id)?.name ?? `#${id}`;
  }

  const isDbKind = form.kind === "mysql" || form.kind === "postgres";

  async function createReplication(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/ha/replications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          sourceHostId: form.sourceHostId || undefined,
          targetHostId: form.targetHostId || undefined,
          dbPort: form.dbPort ? Number(form.dbPort) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setForm(EMPTY_FORM);
      setShowCreate(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setSaving(false);
    }
  }

  async function runSetup(r: Replication, confirmed = false) {
    setBusyId(r.id);
    setError("");
    try {
      const res = await fetch(`/api/ha/replications/${r.id}/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed }),
      });
      const data = await res.json();
      if (res.status === 409 && data.requiresConfirmation) {
        setConfirmingId(r.id);
        return;
      }
      if (!res.ok) throw new Error(data.error);
      setConfirmingId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setBusyId(null);
    }
  }

  async function checkNow(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/ha/replications/${id}/check`, { method: "POST" });
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function toggleEnabled(r: Replication) {
    await fetch(`/api/ha/replications/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !r.enabled }),
    });
    load();
  }

  async function remove(r: Replication) {
    if (!confirm(`Supprimer la réplication "${r.name}" ? Pour mysql/postgres, la réplication déjà démarrée côté base de données continuera de tourner — seule la fiche dans le panel disparaît.`))
      return;
    await fetch(`/api/ha/replications/${r.id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">Haute disponibilité</h1>
          <p className="mt-1 max-w-3xl text-sm text-neutral-400">
            Réplique en continu un dossier ou une base de données d&apos;une machine source vers une machine cible.
            Une fois configurée, branche la machine cible comme serveur de secours dans le{" "}
            <a href="/proxy" className="text-blue-400 hover:underline">
              failover du reverse proxy
            </a>{" "}
            (accessible via Tailscale) pour que la bascule soit automatique si la source devient injoignable.
          </p>
        </div>
        <button
          onClick={() => setShowCreate((s) => !s)}
          className="shrink-0 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
        >
          + Ajouter une réplication
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {showCreate && (
        <form onSubmit={createReplication} className="max-w-2xl space-y-3 rounded border border-neutral-800 p-4">
          <div>
            <label className="mb-1 block text-xs text-neutral-400">Nom</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-400">Type</label>
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as Kind, sourcePath: "", targetPath: "" })}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
            >
              {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-neutral-400">Machine source</label>
              <select
                value={form.sourceHostId}
                onChange={(e) => setForm({ ...form, sourceHostId: e.target.value ? Number(e.target.value) : "" })}
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                required
              >
                <option value="">Sélectionner...</option>
                {hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-400">Machine cible (secours)</label>
              <select
                value={form.targetHostId}
                onChange={(e) => setForm({ ...form, targetHostId: e.target.value ? Number(e.target.value) : "" })}
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                required
              >
                <option value="">Sélectionner...</option>
                {hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-neutral-400">
                {form.kind === "folder" ? "Dossier source" : form.kind === "sqlite" ? "Fichier .db source" : "Nom de la base"}
              </label>
              <input
                value={form.sourcePath}
                onChange={(e) => setForm({ ...form, sourcePath: e.target.value })}
                placeholder={form.kind === "folder" ? "/data/monapp" : form.kind === "sqlite" ? "/data/app.db" : "ma_base"}
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm placeholder:text-neutral-600"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-400">
                {form.kind === "folder" ? "Dossier destination" : form.kind === "sqlite" ? "Fichier .db destination" : "Nom de la base (cible)"}
              </label>
              <input
                value={form.targetPath}
                onChange={(e) => setForm({ ...form, targetPath: e.target.value })}
                placeholder={form.kind === "folder" ? "/data/monapp" : form.kind === "sqlite" ? "/data/app.db" : "ma_base"}
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm placeholder:text-neutral-600"
                required
              />
            </div>
          </div>
          {isDbKind && (
            <div className="space-y-3 rounded border border-neutral-800 p-3">
              <p className="text-xs text-neutral-500">
                Identifiants administrateur, valides sur les deux machines — utilisés une seule fois pour créer un
                rôle de réplication dédié, jamais réutilisés ensuite.
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-neutral-400">Port</label>
                  <input
                    value={form.dbPort}
                    onChange={(e) => setForm({ ...form, dbPort: e.target.value })}
                    placeholder={form.kind === "mysql" ? "3306" : "5432"}
                    inputMode="numeric"
                    className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm placeholder:text-neutral-600"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-neutral-400">Utilisateur admin</label>
                  <input
                    value={form.dbUser}
                    onChange={(e) => setForm({ ...form, dbUser: e.target.value })}
                    className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-neutral-400">Mot de passe admin</label>
                  <input
                    type="password"
                    value={form.dbPassword}
                    onChange={(e) => setForm({ ...form, dbPassword: e.target.value })}
                    className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                    required
                  />
                </div>
              </div>
              {form.kind === "postgres" && (
                <p className="text-xs text-amber-400">
                  ⚠ La configuration effacera le contenu actuel de la base de données sur la machine cible avant de la
                  reconstruire depuis la source (nécessaire pour la réplication PostgreSQL).
                </p>
              )}
            </div>
          )}
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? "Création..." : "Créer"}
          </button>
        </form>
      )}

      <div className="space-y-3">
        {replications.map((r) => (
          <div key={r.id} className="rounded border border-neutral-800 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium text-neutral-100">
                  {r.name} <span className="text-xs text-neutral-500">— {KIND_LABELS[r.kind]}</span>
                </p>
                <p className="text-xs text-neutral-500">
                  {hostName(r.sourceHostId)} → {hostName(r.targetHostId)} · <span className="font-mono">{r.sourcePath}</span> →{" "}
                  <span className="font-mono">{r.targetPath}</span>
                </p>
              </div>
              <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${STATUS_STYLES[r.status]}`}>{STATUS_LABELS[r.status]}</span>
            </div>

            {r.statusDetail && <p className="mt-2 text-xs text-neutral-500">{r.statusDetail}</p>}
            {r.lastSyncedAt && (
              <p className="mt-1 text-xs text-neutral-600">Dernière synchro confirmée : {new Date(`${r.lastSyncedAt}Z`).toLocaleString("fr-FR")}</p>
            )}

            {confirmingId === r.id && (
              <div className="mt-3 rounded border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-200">
                <p className="mb-2">
                  Ceci va effacer le contenu actuel de la base sur <strong>{hostName(r.targetHostId)}</strong> avant de la
                  reconstruire depuis <strong>{hostName(r.sourceHostId)}</strong>. Confirmer ?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => runSetup(r, true)}
                    disabled={busyId === r.id}
                    className="rounded border border-amber-700 px-2 py-1 text-xs text-amber-100 hover:bg-amber-900/40"
                  >
                    Oui, effacer et configurer
                  </button>
                  <button
                    onClick={() => setConfirmingId(null)}
                    className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => runSetup(r)}
                disabled={busyId === r.id || r.status === "setting_up"}
                className="rounded border border-blue-700 bg-blue-900/30 px-2.5 py-1 text-xs text-blue-200 hover:bg-blue-900/50 disabled:opacity-50"
              >
                {r.status === "unknown" ? "Configurer" : "Reconfigurer"}
              </button>
              <button
                onClick={() => checkNow(r.id)}
                disabled={busyId === r.id || r.status === "setting_up"}
                className="rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
              >
                {r.kind === "sqlite" ? "Synchroniser maintenant" : "Vérifier maintenant"}
              </button>
              <label className="flex items-center gap-1.5 text-xs text-neutral-400">
                <input type="checkbox" checked={r.enabled} onChange={() => toggleEnabled(r)} />
                Actif
              </label>
              <button
                onClick={() => remove(r)}
                className="ml-auto rounded border border-red-900 px-2.5 py-1 text-xs text-red-300 hover:bg-red-950/40"
              >
                Supprimer
              </button>
            </div>
          </div>
        ))}
        {replications.length === 0 && (
          <p className="rounded border border-neutral-800 p-6 text-center text-sm text-neutral-600">
            Aucune réplication configurée pour l&apos;instant.
          </p>
        )}
      </div>
    </div>
  );
}
