"use client";

import { useCallback, useEffect, useState } from "react";
import { parseSqliteUtc } from "@/lib/sqliteDate";

type Host = { id: number; name: string };
type ProxyHost = { id: number; domainNames: string[]; forwardPort: number };
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
  targetDbUser: string | null;
  proxyHostId: number | null;
  targetPort: number | null;
  targetOwner: string | null;
  targetMode: string | null;
  targetNeedsSudo: boolean;
  syncScheduleTime: string | null;
  appDbUser: string | null;
  targetDbContainer: string | null;
  sourceDbContainer: string | null;
  enabled: boolean;
  status: "unknown" | "setting_up" | "in_sync" | "lagging" | "error" | "stopped";
  statusDetail: string | null;
  lastCheckedAt: string | null;
  lastSyncedAt: string | null;
};

type HaStateEntry = {
  replicationId: string;
  proxyHostId: number;
  sourceHostName: string;
  targetHostName: string;
  servedBy: "source" | "target" | "unknown";
  needsResyncReminder: boolean;
  lastFailbackAt: string | null;
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
  targetDbUser: "",
  targetDbPassword: "",
  proxyHostId: "" as number | "",
  targetPort: "",
  targetOwner: "",
  targetMode: "",
  targetNeedsSudo: false,
  syncScheduleTime: "",
  appDbUser: "",
  appDbPassword: "",
  targetDbContainer: "",
  sourceDbContainer: "",
};

// Deliberately no kind/sourceHostId/targetHostId here — those drive which SSH keys/dirs were
// provisioned and on which machines, so changing them is a different replication, not an edit of
// this one (delete and recreate instead). Password fields always start blank (never re-sent to the
// browser) and are left untouched server-side when submitted blank.
const EMPTY_EDIT_FORM = {
  name: "",
  sourcePath: "",
  targetPath: "",
  dbPort: "",
  dbUser: "",
  dbPassword: "",
  targetDbUser: "",
  targetDbPassword: "",
  targetOwner: "",
  targetMode: "",
  targetNeedsSudo: false,
  syncScheduleTime: "",
  appDbUser: "",
  appDbPassword: "",
  targetDbContainer: "",
  sourceDbContainer: "",
  proxyHostId: "" as number | "",
  targetPort: "",
};

export default function HaPage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [proxyHosts, setProxyHosts] = useState<ProxyHost[]>([]);
  const [replications, setReplications] = useState<Replication[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_EDIT_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmingReverseSyncId, setConfirmingReverseSyncId] = useState<string | null>(null);
  const [differentTargetCreds, setDifferentTargetCreds] = useState(false);
  const [availableDatabases, setAvailableDatabases] = useState<string[] | null>(null);
  const [listingDatabases, setListingDatabases] = useState(false);
  const [listDatabasesError, setListDatabasesError] = useState("");
  const [haState, setHaState] = useState<HaStateEntry[]>([]);
  const [dismissingReminder, setDismissingReminder] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [hostsRes, replRes, proxyRes, stateRes] = await Promise.all([
      fetch("/api/hosts"),
      fetch("/api/ha/replications"),
      fetch("/api/npm/hosts").catch(() => null),
      fetch("/api/ha/state").catch(() => null),
    ]);
    const hostsData = await hostsRes.json();
    const replData = await replRes.json();
    setHosts(hostsData.hosts ?? hostsData ?? []);
    setReplications(replData.replications ?? []);
    if (proxyRes?.ok) {
      const proxyData = await proxyRes.json();
      setProxyHosts(proxyData.hosts ?? []);
    }
    if (stateRes?.ok) {
      const stateData = await stateRes.json();
      setHaState(stateData.entries ?? []);
    }
  }, []);

  async function dismissReminder(proxyHostId: number) {
    setDismissingReminder(proxyHostId);
    try {
      await fetch(`/api/ha/state/${proxyHostId}/dismiss-reminder`, { method: "POST" });
      await load();
    } finally {
      setDismissingReminder(null);
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  // Keeps the page live without a manual reload: the panel's own background scheduler
  // (checkAllReplications, server.ts) re-checks every enabled replication and updates its
  // status/lastSyncedAt independently of anyone having this page open at all — without this poll,
  // that only ever became visible on the next full page reload, which reads as "did this actually
  // just check, or is it stuck?" for anything that isn't mid-setup. A replication actively being
  // configured polls quickly (its own status/statusDetail changes step by step); once settled, a
  // slower interval is still enough to track the scheduler's own ~30s cadence without hammering the
  // API for something that rarely changes.
  useEffect(() => {
    const fast = replications.some((r) => r.status === "setting_up");
    const timer = setInterval(load, fast ? 3000 : 20_000);
    return () => clearInterval(timer);
  }, [replications, load]);

  function hostName(id: number) {
    return hosts.find((h) => h.id === id)?.name ?? `#${id}`;
  }

  function proxyHostLabel(id: number | null) {
    if (!id) return null;
    const p = proxyHosts.find((h) => h.id === id);
    return p ? p.domainNames.join(", ") : `#${id}`;
  }

  const isDbKind = form.kind === "mysql" || form.kind === "postgres";

  function parseDbNames(value: string): string[] {
    return value
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function toggleDbName(name: string) {
    const current = parseDbNames(form.sourcePath);
    const next = current.includes(name) ? current.filter((n) => n !== name) : [...current, name];
    setForm({ ...form, sourcePath: next.join(", ") });
  }

  async function listSourceDatabases() {
    if (!form.sourceHostId || !form.dbUser.trim() || !form.dbPassword) return;
    setListingDatabases(true);
    setListDatabasesError("");
    try {
      const res = await fetch("/api/ha/mysql-databases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostId: form.sourceHostId,
          port: form.dbPort ? Number(form.dbPort) : undefined,
          dbUser: form.dbUser,
          dbPassword: form.dbPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAvailableDatabases(data.databases);
    } catch (err) {
      setListDatabasesError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setListingDatabases(false);
    }
  }

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
          targetDbUser: differentTargetCreds ? form.targetDbUser : undefined,
          targetDbPassword: differentTargetCreds ? form.targetDbPassword : undefined,
          proxyHostId: form.proxyHostId || undefined,
          targetPort: form.targetPort ? Number(form.targetPort) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setForm(EMPTY_FORM);
      setShowCreate(false);
      setDifferentTargetCreds(false);
      setAvailableDatabases(null);
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

  async function runReverseSync(r: Replication, confirmed = false) {
    setBusyId(r.id);
    setError("");
    try {
      const res = await fetch(`/api/ha/replications/${r.id}/reverse-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed }),
      });
      const data = await res.json();
      if (res.status === 409 && data.requiresConfirmation) {
        setConfirmingReverseSyncId(r.id);
        return;
      }
      if (!res.ok) throw new Error(data.error);
      setConfirmingReverseSyncId(null);
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

  async function rewireFailover(id: string) {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/ha/replications/${id}/wire-failover`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
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

  async function duplicateReplication(r: Replication) {
    setBusyId(r.id);
    setError("");
    try {
      const res = await fetch(`/api/ha/replications/${r.id}/duplicate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await load();
      startEdit(data.replication);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setBusyId(null);
    }
  }

  function startEdit(r: Replication) {
    setError("");
    setEditingId(r.id);
    setEditForm({
      name: r.name,
      sourcePath: r.sourcePath,
      targetPath: r.targetPath,
      dbPort: r.dbPort ? String(r.dbPort) : "",
      dbUser: r.dbUser ?? "",
      dbPassword: "",
      targetDbUser: r.targetDbUser ?? "",
      targetDbPassword: "",
      targetOwner: r.targetOwner ?? "",
      targetMode: r.targetMode ?? "",
      targetNeedsSudo: r.targetNeedsSudo,
      syncScheduleTime: r.syncScheduleTime ?? "",
      appDbUser: r.appDbUser ?? "",
      appDbPassword: "",
      targetDbContainer: r.targetDbContainer ?? "",
      sourceDbContainer: r.sourceDbContainer ?? "",
      proxyHostId: r.proxyHostId ?? "",
      targetPort: r.targetPort ? String(r.targetPort) : "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(EMPTY_EDIT_FORM);
  }

  async function saveEdit(r: Replication) {
    setBusyId(r.id);
    setError("");
    try {
      const isDbKind = r.kind === "mysql" || r.kind === "postgres";
      const res = await fetch(`/api/ha/replications/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name,
          sourcePath: editForm.sourcePath,
          targetPath: isDbKind ? undefined : editForm.targetPath,
          dbPort: editForm.dbPort ? Number(editForm.dbPort) : null,
          dbUser: editForm.dbUser,
          dbPassword: editForm.dbPassword || undefined,
          targetDbUser: editForm.targetDbUser,
          targetDbPassword: editForm.targetDbPassword || undefined,
          targetOwner: editForm.targetOwner,
          targetMode: editForm.targetMode,
          targetNeedsSudo: r.kind === "folder" ? editForm.targetNeedsSudo : undefined,
          syncScheduleTime: r.kind === "folder" ? editForm.syncScheduleTime : undefined,
          appDbUser: editForm.appDbUser,
          appDbPassword: editForm.appDbPassword || undefined,
          targetDbContainer: editForm.targetDbContainer,
          sourceDbContainer: editForm.sourceDbContainer,
          proxyHostId: editForm.proxyHostId || null,
          targetPort: editForm.targetPort ? Number(editForm.targetPort) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      cancelEdit();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleNeedsSudo(r: Replication) {
    setBusyId(r.id);
    try {
      await fetch(`/api/ha/replications/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetNeedsSudo: !r.targetNeedsSudo }),
      });
      load();
    } finally {
      setBusyId(null);
    }
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
            Associe une redirection NPM à la création pour que la bascule vers la machine cible (via son adresse
            Tailscale) se branche automatiquement dans le{" "}
            <a href="/proxy" className="text-blue-400 hover:underline">
              failover du reverse proxy
            </a>{" "}
            dès que la configuration réussit — plus besoin de le faire à la main.
          </p>
          <p className="mt-2 max-w-3xl rounded border border-amber-900 bg-amber-950/20 p-2 text-xs text-amber-300">
            ⚠ La réplication ne se fait que dans un sens (source → cible). Une fois basculé sur la machine de secours,
            tout ce qui y est écrit (nouvelles commandes, uploads...) n&apos;est pas renvoyé vers la source : remettre
            la source en ligne et y refaire pointer le failover sans avoir d&apos;abord resynchronisé manuellement les
            données écrites pendant la panne effacerait ces changements. Après un vrai basculement, resynchronise la
            cible vers la source (ou inversement, selon où sont les données à jour) avant de revenir en arrière.
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
              onChange={(e) => {
                setForm({ ...form, kind: e.target.value as Kind, sourcePath: "", targetPath: "" });
                setAvailableDatabases(null);
                setListDatabasesError("");
              }}
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
          <div className={form.kind === "mysql" ? "" : "grid grid-cols-2 gap-3"}>
            <div>
              <label className="mb-1 block text-xs text-neutral-400">
                {form.kind === "folder"
                  ? "Dossier source"
                  : form.kind === "sqlite"
                    ? "Fichier .db source"
                    : form.kind === "mysql"
                      ? "Bases de données (une ou plusieurs)"
                      : "Nom de la base"}
              </label>
              <input
                value={form.sourcePath}
                onChange={(e) => setForm({ ...form, sourcePath: e.target.value })}
                placeholder={
                  form.kind === "folder"
                    ? "/data/monapp"
                    : form.kind === "sqlite"
                      ? "/data/app.db"
                      : form.kind === "mysql"
                        ? "ma_base, autre_base"
                        : "ma_base"
                }
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm placeholder:text-neutral-600"
                required
              />
              {form.kind === "mysql" && (
                <div className="mt-2 space-y-1.5">
                  <button
                    type="button"
                    onClick={listSourceDatabases}
                    disabled={!form.sourceHostId || !form.dbUser.trim() || !form.dbPassword || listingDatabases}
                    className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
                  >
                    {listingDatabases ? "Connexion…" : "Lister les bases de la machine source"}
                  </button>
                  {listDatabasesError && <p className="whitespace-pre-line text-xs text-red-400">{listDatabasesError}</p>}
                  {availableDatabases && (
                    <div className="flex flex-wrap gap-1.5 rounded border border-neutral-800 bg-neutral-950 p-2">
                      {availableDatabases.length === 0 && (
                        <span className="text-xs text-neutral-600">Aucune base trouvée (hors bases système).</span>
                      )}
                      {availableDatabases.map((db) => {
                        const checked = parseDbNames(form.sourcePath).includes(db);
                        return (
                          <label
                            key={db}
                            className={`flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-xs ${
                              checked ? "border-blue-700 bg-blue-950/40 text-blue-200" : "border-neutral-700 text-neutral-400"
                            }`}
                          >
                            <input type="checkbox" checked={checked} onChange={() => toggleDbName(db)} className="hidden" />
                            {db}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
            {form.kind !== "mysql" && form.kind !== "postgres" && (
              <div>
                <label className="mb-1 block text-xs text-neutral-400">
                  {form.kind === "folder" ? "Dossier destination" : "Fichier .db destination"}
                </label>
                <input
                  value={form.targetPath}
                  onChange={(e) => setForm({ ...form, targetPath: e.target.value })}
                  placeholder={form.kind === "folder" ? "/data/monapp" : "/data/app.db"}
                  className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm placeholder:text-neutral-600"
                  required
                />
              </div>
            )}
          </div>
          {form.kind === "postgres" && (
            <div>
              <label className="mb-1 block text-xs text-neutral-400">Nom de la base (repère seulement)</label>
              <input
                value={form.sourcePath}
                onChange={(e) => setForm({ ...form, sourcePath: e.target.value })}
                placeholder="ma_base"
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm placeholder:text-neutral-600"
                required
              />
              <p className="mt-1 text-xs text-neutral-600">
                pg_basebackup clone tout le serveur PostgreSQL, pas une base en particulier — ce nom n&apos;est là que
                pour t&apos;y retrouver dans la liste ci-dessous.
              </p>
              <p className="mt-1 text-xs text-amber-500">
                ⚠ Contrairement à MySQL/MariaDB, la réplication PostgreSQL nécessite pour l&apos;instant une
                installation native de PostgreSQL sur les deux machines (arrêt/redémarrage du service et accès direct
                au dossier de données requis par pg_basebackup) — pas encore de mode Docker container ici.
              </p>
            </div>
          )}
          {(form.kind === "folder" || form.kind === "sqlite") && (
            <div className="space-y-2 rounded border border-neutral-800 p-3">
              <p className="text-xs text-neutral-500">
                Le dossier/fichier cible doit être un chemin réel sur le système de fichiers de la machine cible — un
                bind mount Docker (ex: <code>/opt/monapp/www</code> monté dans le container) fonctionne directement.
                Pour un volume Docker <em>nommé</em>, résous d&apos;abord son point de montage réel sur l&apos;hôte
                avec <code>docker volume inspect --format &apos;{"{{ .Mountpoint }}"}&apos; &lt;nom&gt;</code> et
                utilise ce chemin ici.
              </p>
              <p className="text-xs text-neutral-500">
                Optionnel — sans ça, les fichiers arrivent sur la machine cible appartenant au compte SSH dédié à la
                réplication, pas forcément au compte qui fait tourner le serveur web là-bas.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-neutral-400">Propriétaire sur la cible (user:groupe)</label>
                  <input
                    value={form.targetOwner}
                    onChange={(e) => setForm({ ...form, targetOwner: e.target.value })}
                    placeholder="www-data:www-data"
                    className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm placeholder:text-neutral-600"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-neutral-400">Droits sur la cible</label>
                  <input
                    value={form.targetMode}
                    onChange={(e) => setForm({ ...form, targetMode: e.target.value })}
                    placeholder="D755,F644"
                    className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm placeholder:text-neutral-600"
                  />
                </div>
              </div>
              {form.kind === "folder" && (
                <label className="flex items-start gap-2 pt-1 text-xs text-neutral-400">
                  <input
                    type="checkbox"
                    checked={form.targetNeedsSudo}
                    onChange={(e) => setForm({ ...form, targetNeedsSudo: e.target.checked })}
                    className="mt-0.5"
                  />
                  <span>
                    Le compte SSH cible a besoin de sudo pour écrire (CyberPanel, cPanel, Plesk…) — chaque site y est
                    isolé sous son propre compte système, inaccessible au compte de réplication partagé. Nécessite une
                    règle sudoers sans mot de passe sur la machine cible pour ce compte, par ex. :{" "}
                    <code className="text-neutral-300">
                      echo &quot;utilisateur ALL=(ALL) NOPASSWD: /usr/bin/rsync&quot; | sudo tee
                      /etc/sudoers.d/homelab-panel-rsync
                    </code>{" "}
                    (à faire une fois, manuellement — le panel ne touche pas aux sudoers).
                  </span>
                </label>
              )}
              {form.kind === "folder" && (
                <div className="space-y-2 rounded border border-neutral-800 p-3">
                  <label className="mb-1 block text-xs text-neutral-400">Mode de synchronisation</label>
                  <select
                    value={form.syncScheduleTime ? "scheduled" : "continuous"}
                    onChange={(e) => setForm({ ...form, syncScheduleTime: e.target.value === "scheduled" ? "03:00" : "" })}
                    className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                  >
                    <option value="continuous">Continu (lsyncd — propagation quasi immédiate)</option>
                    <option value="scheduled">Planifié (un seul passage rsync par jour)</option>
                  </select>
                  {form.syncScheduleTime ? (
                    <>
                      <label className="mb-1 block text-xs text-neutral-400">Heure du passage quotidien</label>
                      <input
                        type="time"
                        value={form.syncScheduleTime}
                        onChange={(e) => setForm({ ...form, syncScheduleTime: e.target.value })}
                        className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                      />
                      <p className="text-xs text-neutral-500">
                        Un seul rsync complet par jour à cette heure, au lieu d&apos;un resync continu à chaque
                        changement de fichier — recommandé pour un site volumineux ou avec beaucoup d&apos;écritures
                        (cache, sessions…), pour qui lsyncd finit par saturer le CPU de la machine source.
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-neutral-500">
                      lsyncd surveille le dossier en continu et repousse chaque changement en quasi temps réel — idéal
                      pour un petit site, coûteux en CPU sur un site gros ou très écrit.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          {isDbKind && (
            <div className="space-y-3 rounded border border-neutral-800 p-3">
              <p className="text-xs text-neutral-500">
                Identifiants administrateur de la machine source — utilisés une seule fois pour créer un rôle de
                réplication dédié, jamais réutilisés ensuite. Si le mot de passe admin est différent sur la machine
                cible, coche la case ci-dessous pour le préciser séparément — sinon celui-ci est réutilisé tel quel.
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
                  <label className="mb-1 block text-xs text-neutral-400">Utilisateur admin (source)</label>
                  <input
                    value={form.dbUser}
                    onChange={(e) => setForm({ ...form, dbUser: e.target.value })}
                    className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-neutral-400">Mot de passe admin (source)</label>
                  <input
                    type="password"
                    value={form.dbPassword}
                    onChange={(e) => setForm({ ...form, dbPassword: e.target.value })}
                    className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                    required
                  />
                </div>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-neutral-400">
                <input
                  type="checkbox"
                  checked={differentTargetCreds}
                  onChange={(e) => {
                    setDifferentTargetCreds(e.target.checked);
                    if (!e.target.checked) setForm({ ...form, targetDbUser: "", targetDbPassword: "" });
                  }}
                />
                Identifiants admin différents sur la machine cible
              </label>
              {differentTargetCreds && (
                <div className="grid grid-cols-2 gap-3 border-t border-neutral-800 pt-3">
                  <div>
                    <label className="mb-1 block text-xs text-neutral-400">Utilisateur admin (cible)</label>
                    <input
                      value={form.targetDbUser}
                      onChange={(e) => setForm({ ...form, targetDbUser: e.target.value })}
                      className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-neutral-400">Mot de passe admin (cible)</label>
                    <input
                      type="password"
                      value={form.targetDbPassword}
                      onChange={(e) => setForm({ ...form, targetDbPassword: e.target.value })}
                      className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                      required
                    />
                  </div>
                </div>
              )}
              {form.kind === "mysql" && (
                <p className="text-xs text-neutral-600">
                  La ou les bases sont créées automatiquement sur la machine cible si elles n&apos;y existent pas déjà
                  — mysqldump s&apos;en charge lui-même, rien à cocher.
                </p>
              )}
              {form.kind === "mysql" && (
                <div className="grid grid-cols-2 gap-3 border-t border-neutral-800 pt-3">
                  <div>
                    <label className="mb-1 block text-xs text-neutral-400">
                      Container Docker sur la machine source (optionnel)
                    </label>
                    <input
                      value={form.sourceDbContainer}
                      onChange={(e) => setForm({ ...form, sourceDbContainer: e.target.value })}
                      placeholder="ex: mariadb"
                      className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm placeholder:text-neutral-600"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-neutral-400">
                      Container Docker sur la machine cible (optionnel)
                    </label>
                    <input
                      value={form.targetDbContainer}
                      onChange={(e) => setForm({ ...form, targetDbContainer: e.target.value })}
                      placeholder="ex: mariadb"
                      className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm placeholder:text-neutral-600"
                    />
                  </div>
                  <p className="col-span-2 text-xs text-neutral-600">
                    Laisse vide côté source et/ou cible quand cette machine a un client mysql/mariadb natif sur son
                    propre système. Si sa base de données ne tourne que dans un container Docker (aucun client natif
                    sur l&apos;hôte), indique le nom du container correspondant ici — le panel exécutera toutes les
                    commandes SQL de configuration de cette machine via <code>docker exec</code> dans ce container au
                    lieu de s&apos;y connecter/l&apos;administrer nativement. Source et cible sont indépendants :
                    n&apos;importe quelle combinaison native/Docker fonctionne (native → Docker, Docker → native,
                    Docker → Docker...).
                  </p>
                </div>
              )}
              {form.kind === "mysql" && (
                <div className="grid grid-cols-2 gap-3 border-t border-neutral-800 pt-3">
                  <div className="col-span-2">
                    <p className="text-xs text-neutral-500">
                      Optionnel — identifiant de connexion de l&apos;application elle-même (différent de l&apos;admin
                      ci-dessus). mysqldump ne copie que les données de la base, jamais les comptes MySQL : sans ça,
                      l&apos;application n&apos;aurait tout simplement pas de compte pour se connecter sur la machine
                      cible après une bascule.
                    </p>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-neutral-400">Utilisateur applicatif</label>
                    <input
                      value={form.appDbUser}
                      onChange={(e) => setForm({ ...form, appDbUser: e.target.value })}
                      className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-neutral-400">Mot de passe applicatif</label>
                    <input
                      type="password"
                      value={form.appDbPassword}
                      onChange={(e) => setForm({ ...form, appDbPassword: e.target.value })}
                      className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                    />
                  </div>
                </div>
              )}
              {form.kind === "postgres" && (
                <p className="text-xs text-amber-400">
                  ⚠ La configuration effacera le contenu actuel de la base de données sur la machine cible avant de la
                  reconstruire depuis la source (nécessaire pour la réplication PostgreSQL). Les comptes applicatifs
                  sont automatiquement répliqués avec le reste (pg_basebackup clone tout le serveur, comptes inclus) —
                  rien à configurer ici.
                </p>
              )}
            </div>
          )}

          <div className="space-y-2 rounded border border-neutral-800 p-3">
            <p className="text-xs text-neutral-500">
              Optionnel — associe cette réplication à une redirection du reverse proxy : une fois configurée avec
              succès, la machine cible est automatiquement branchée comme serveur de secours dans le failover NPM déjà
              existant pour cette redirection (bascule automatique si la source tombe).
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-neutral-400">Redirection NPM à protéger</label>
                <select
                  value={form.proxyHostId}
                  onChange={(e) => setForm({ ...form, proxyHostId: e.target.value ? Number(e.target.value) : "" })}
                  className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                >
                  <option value="">Aucune</option>
                  {proxyHosts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.domainNames.join(", ")}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-neutral-400">Port sur la machine cible (si différent)</label>
                <input
                  value={form.targetPort}
                  onChange={(e) => setForm({ ...form, targetPort: e.target.value })}
                  placeholder="identique à la redirection"
                  inputMode="numeric"
                  disabled={!form.proxyHostId}
                  className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm placeholder:text-neutral-600 disabled:opacity-50"
                />
              </div>
            </div>
          </div>

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
                  {hostName(r.sourceHostId)} → {hostName(r.targetHostId)} ·{" "}
                  {r.kind === "mysql" || r.kind === "postgres" ? (
                    <span className="font-mono">{r.sourcePath}</span>
                  ) : (
                    <>
                      <span className="font-mono">{r.sourcePath}</span> → <span className="font-mono">{r.targetPath}</span>
                    </>
                  )}
                </p>
                {r.kind === "folder" && (
                  <p className="mt-0.5 text-xs text-neutral-600">
                    Mode :{" "}
                    <span className="text-neutral-400">
                      {r.syncScheduleTime ? `Planifié, tous les jours à ${r.syncScheduleTime}` : "Continu (lsyncd)"}
                    </span>
                  </p>
                )}
                {r.proxyHostId && (
                  <p className="mt-0.5 text-xs text-neutral-600">
                    Failover NPM : <span className="text-neutral-400">{proxyHostLabel(r.proxyHostId)}</span>
                    {r.targetPort ? ` (port ${r.targetPort})` : ""}
                  </p>
                )}
                {(() => {
                  const state = haState.find((s) => s.replicationId === r.id);
                  if (!state) return null;
                  return (
                    <>
                      <p className="mt-0.5 text-xs">
                        Actuellement servi par :{" "}
                        <span
                          className={
                            state.servedBy === "source"
                              ? "text-emerald-400"
                              : state.servedBy === "target"
                                ? "text-amber-400"
                                : "text-neutral-500"
                          }
                        >
                          {state.servedBy === "source"
                            ? state.sourceHostName
                            : state.servedBy === "target"
                              ? `${state.targetHostName} (secours)`
                              : "inconnu"}
                        </span>
                      </p>
                      {state.needsResyncReminder && (
                        <p className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-400">
                          <span>
                            {state.sourceHostName} a repris la main — penser à vérifier si une resynchro depuis {state.targetHostName} est nécessaire.
                          </span>
                          <button
                            onClick={() => dismissReminder(state.proxyHostId)}
                            disabled={dismissingReminder === state.proxyHostId}
                            className="text-neutral-400 hover:underline disabled:opacity-50"
                          >
                            {dismissingReminder === state.proxyHostId ? "..." : "Marquer comme vérifié"}
                          </button>
                        </p>
                      )}
                    </>
                  );
                })()}
                {(r.sourceDbContainer || r.targetDbContainer) && (
                  <p className="mt-0.5 text-xs text-neutral-600">
                    Admin SQL via docker exec —
                    {r.sourceDbContainer && (
                      <>
                        {" "}
                        source : <span className="font-mono text-neutral-400">{r.sourceDbContainer}</span>
                      </>
                    )}
                    {r.targetDbContainer && (
                      <>
                        {" "}
                        cible : <span className="font-mono text-neutral-400">{r.targetDbContainer}</span>
                      </>
                    )}
                  </p>
                )}
              </div>
              <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${STATUS_STYLES[r.status]}`}>{STATUS_LABELS[r.status]}</span>
            </div>

            {r.statusDetail && (
              <p className="mt-2 whitespace-pre-line rounded bg-neutral-900 p-2 font-mono text-[11px] leading-relaxed text-neutral-500">
                {r.statusDetail}
              </p>
            )}
            {r.lastSyncedAt && (
              <p className="mt-1 text-xs text-neutral-600">Dernière synchro confirmée : {parseSqliteUtc(r.lastSyncedAt).toLocaleString("fr-FR")}</p>
            )}

            {editingId === r.id && (
              <div className="mt-3 space-y-3 rounded border border-neutral-800 bg-neutral-900/40 p-3">
                <div>
                  <label className="mb-1 block text-xs text-neutral-400">Nom</label>
                  <input
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                  />
                </div>
                {(r.kind === "folder" || r.kind === "sqlite") && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs text-neutral-400">Chemin source</label>
                      <input
                        value={editForm.sourcePath}
                        onChange={(e) => setEditForm({ ...editForm, sourcePath: e.target.value })}
                        className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-neutral-400">Chemin cible</label>
                      <input
                        value={editForm.targetPath}
                        onChange={(e) => setEditForm({ ...editForm, targetPath: e.target.value })}
                        className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-sm"
                      />
                    </div>
                  </div>
                )}
                {(r.kind === "folder" || r.kind === "sqlite") && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs text-neutral-400">Propriétaire sur la cible</label>
                      <input
                        value={editForm.targetOwner}
                        onChange={(e) => setEditForm({ ...editForm, targetOwner: e.target.value })}
                        placeholder="www-data:www-data"
                        className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm placeholder:text-neutral-600"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-neutral-400">Droits sur la cible</label>
                      <input
                        value={editForm.targetMode}
                        onChange={(e) => setEditForm({ ...editForm, targetMode: e.target.value })}
                        placeholder="D755,F644"
                        className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm placeholder:text-neutral-600"
                      />
                    </div>
                  </div>
                )}
                {r.kind === "folder" && (
                  <label className="flex items-center gap-1.5 text-xs text-neutral-400">
                    <input
                      type="checkbox"
                      checked={editForm.targetNeedsSudo}
                      onChange={(e) => setEditForm({ ...editForm, targetNeedsSudo: e.target.checked })}
                    />
                    Le compte SSH cible a besoin de sudo pour écrire (CyberPanel, cPanel, Plesk…)
                  </label>
                )}
                {r.kind === "folder" && (
                  <div className="space-y-2 rounded border border-neutral-800 p-3">
                    <label className="mb-1 block text-xs text-neutral-400">Mode de synchronisation</label>
                    <select
                      value={editForm.syncScheduleTime ? "scheduled" : "continuous"}
                      onChange={(e) =>
                        setEditForm({ ...editForm, syncScheduleTime: e.target.value === "scheduled" ? "03:00" : "" })
                      }
                      className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                    >
                      <option value="continuous">Continu (lsyncd — propagation quasi immédiate)</option>
                      <option value="scheduled">Planifié (un seul passage rsync par jour)</option>
                    </select>
                    {editForm.syncScheduleTime && (
                      <>
                        <label className="mb-1 block text-xs text-neutral-400">Heure du passage quotidien</label>
                        <input
                          type="time"
                          value={editForm.syncScheduleTime}
                          onChange={(e) => setEditForm({ ...editForm, syncScheduleTime: e.target.value })}
                          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                        />
                      </>
                    )}
                  </div>
                )}
                {(r.kind === "mysql" || r.kind === "postgres") && (
                  <>
                    <div>
                      <label className="mb-1 block text-xs text-neutral-400">
                        {r.kind === "mysql" ? "Base(s) (séparées par une virgule)" : "Base"}
                      </label>
                      <input
                        value={editForm.sourcePath}
                        onChange={(e) => setEditForm({ ...editForm, sourcePath: e.target.value })}
                        className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="mb-1 block text-xs text-neutral-400">Port</label>
                        <input
                          value={editForm.dbPort}
                          onChange={(e) => setEditForm({ ...editForm, dbPort: e.target.value })}
                          inputMode="numeric"
                          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-neutral-400">Utilisateur admin (source)</label>
                        <input
                          value={editForm.dbUser}
                          onChange={(e) => setEditForm({ ...editForm, dbUser: e.target.value })}
                          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-neutral-400">Mot de passe admin (source)</label>
                        <input
                          type="password"
                          value={editForm.dbPassword}
                          onChange={(e) => setEditForm({ ...editForm, dbPassword: e.target.value })}
                          placeholder="inchangé si vide"
                          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm placeholder:text-neutral-600"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 border-t border-neutral-800 pt-3">
                      <div>
                        <label className="mb-1 block text-xs text-neutral-400">Utilisateur admin (cible, si différent)</label>
                        <input
                          value={editForm.targetDbUser}
                          onChange={(e) => setEditForm({ ...editForm, targetDbUser: e.target.value })}
                          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-neutral-400">Mot de passe admin (cible)</label>
                        <input
                          type="password"
                          value={editForm.targetDbPassword}
                          onChange={(e) => setEditForm({ ...editForm, targetDbPassword: e.target.value })}
                          placeholder="inchangé si vide"
                          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm placeholder:text-neutral-600"
                        />
                      </div>
                    </div>
                  </>
                )}
                {r.kind === "mysql" && (
                  <>
                    <div className="grid grid-cols-2 gap-3 border-t border-neutral-800 pt-3">
                      <div>
                        <label className="mb-1 block text-xs text-neutral-400">Container Docker (source)</label>
                        <input
                          value={editForm.sourceDbContainer}
                          onChange={(e) => setEditForm({ ...editForm, sourceDbContainer: e.target.value })}
                          placeholder="ex: mariadb"
                          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm placeholder:text-neutral-600"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-neutral-400">Container Docker (cible)</label>
                        <input
                          value={editForm.targetDbContainer}
                          onChange={(e) => setEditForm({ ...editForm, targetDbContainer: e.target.value })}
                          placeholder="ex: mariadb"
                          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm placeholder:text-neutral-600"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 border-t border-neutral-800 pt-3">
                      <div>
                        <label className="mb-1 block text-xs text-neutral-400">Utilisateur applicatif</label>
                        <input
                          value={editForm.appDbUser}
                          onChange={(e) => setEditForm({ ...editForm, appDbUser: e.target.value })}
                          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-neutral-400">Mot de passe applicatif</label>
                        <input
                          type="password"
                          value={editForm.appDbPassword}
                          onChange={(e) => setEditForm({ ...editForm, appDbPassword: e.target.value })}
                          placeholder="inchangé si vide"
                          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm placeholder:text-neutral-600"
                        />
                      </div>
                    </div>
                  </>
                )}
                <div className="space-y-2 border-t border-neutral-800 pt-3">
                  <p className="text-xs text-neutral-500">
                    Branchement failover NPM — une fois enregistré, "Rebrancher le failover" applique la nouvelle
                    cible/port au reverse proxy.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs text-neutral-400">Redirection NPM à protéger</label>
                      <select
                        value={editForm.proxyHostId}
                        onChange={(e) => setEditForm({ ...editForm, proxyHostId: e.target.value ? Number(e.target.value) : "" })}
                        className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                      >
                        <option value="">Aucune</option>
                        {proxyHosts.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.domainNames.join(", ")}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-neutral-400">Port sur la machine cible (si différent)</label>
                      <input
                        value={editForm.targetPort}
                        onChange={(e) => setEditForm({ ...editForm, targetPort: e.target.value })}
                        placeholder="identique à la redirection"
                        inputMode="numeric"
                        disabled={!editForm.proxyHostId}
                        className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm placeholder:text-neutral-600 disabled:opacity-50"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 border-t border-neutral-800 pt-3">
                  <button
                    onClick={() => saveEdit(r)}
                    disabled={busyId === r.id}
                    className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    Enregistrer
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                  >
                    Annuler
                  </button>
                </div>
              </div>
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

            {confirmingReverseSyncId === r.id && (
              <div className="mt-3 rounded border border-red-800 bg-red-950/30 p-3 text-sm text-red-200">
                <p className="mb-2">
                  Ceci va <strong>écraser</strong> le contenu actuel de <strong>{hostName(r.sourceHostId)}</strong> (la
                  source) avec celui de <strong>{hostName(r.targetHostId)}</strong> (la cible) — à utiliser après un
                  vrai basculement, quand la cible contient les données à jour et que la source a pris du retard.
                  Confirmer ?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => runReverseSync(r, true)}
                    disabled={busyId === r.id}
                    className="rounded border border-red-700 px-2 py-1 text-xs text-red-100 hover:bg-red-900/40"
                  >
                    Oui, écraser la source
                  </button>
                  <button
                    onClick={() => setConfirmingReverseSyncId(null)}
                    className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => (editingId === r.id ? cancelEdit() : startEdit(r))}
                disabled={busyId === r.id}
                className="rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
              >
                {editingId === r.id ? "Fermer l'édition" : "Modifier"}
              </button>
              <button
                onClick={() => duplicateReplication(r)}
                disabled={busyId === r.id}
                title="Crée une nouvelle réplication avec les mêmes réglages (identifiants inclus) — pratique pour protéger un nouveau site/base avec la même cible et les mêmes identifiants admin."
                className="rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
              >
                Dupliquer
              </button>
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
              {r.proxyHostId && (
                <button
                  onClick={() => rewireFailover(r.id)}
                  disabled={busyId === r.id}
                  className="rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
                >
                  Rebrancher le failover
                </button>
              )}
              {(r.kind === "folder" || r.kind === "mysql") && (
                <button
                  onClick={() => runReverseSync(r)}
                  disabled={busyId === r.id || r.status === "setting_up"}
                  title="Après un vrai basculement : écrase la source avec les données actuelles de la cible, puis reprend la réplication normale."
                  className="rounded border border-red-900 px-2.5 py-1 text-xs text-red-300 hover:bg-red-950/40 disabled:opacity-50"
                >
                  Resynchroniser depuis la cible
                </button>
              )}
              <label className="flex items-center gap-1.5 text-xs text-neutral-400">
                <input type="checkbox" checked={r.enabled} onChange={() => toggleEnabled(r)} />
                Actif
              </label>
              {r.kind === "folder" && (
                <label
                  className="flex items-center gap-1.5 text-xs text-neutral-400"
                  title="Passe par sudo côté cible pour écrire (CyberPanel, cPanel...) — nécessite une règle sudoers NOPASSWD pour rsync sur ce compte, à poser manuellement sur la machine cible."
                >
                  <input
                    type="checkbox"
                    checked={r.targetNeedsSudo}
                    disabled={busyId === r.id}
                    onChange={() => toggleNeedsSudo(r)}
                  />
                  Sudo côté cible
                </label>
              )}
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
