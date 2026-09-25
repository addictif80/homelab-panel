"use client";

import { useCallback, useEffect, useState } from "react";

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
  appDbUser: string | null;
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
  targetDbUser: "",
  targetDbPassword: "",
  proxyHostId: "" as number | "",
  targetPort: "",
  targetOwner: "",
  targetMode: "",
  appDbUser: "",
  appDbPassword: "",
};

export default function HaPage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [proxyHosts, setProxyHosts] = useState<ProxyHost[]>([]);
  const [replications, setReplications] = useState<Replication[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [differentTargetCreds, setDifferentTargetCreds] = useState(false);
  const [availableDatabases, setAvailableDatabases] = useState<string[] | null>(null);
  const [listingDatabases, setListingDatabases] = useState(false);
  const [listDatabasesError, setListDatabasesError] = useState("");

  const load = useCallback(async () => {
    const [hostsRes, replRes, proxyRes] = await Promise.all([
      fetch("/api/hosts"),
      fetch("/api/ha/replications"),
      fetch("/api/npm/hosts").catch(() => null),
    ]);
    const hostsData = await hostsRes.json();
    const replData = await replRes.json();
    setHosts(hostsData.hosts ?? hostsData ?? []);
    setReplications(replData.replications ?? []);
    if (proxyRes?.ok) {
      const proxyData = await proxyRes.json();
      setProxyHosts(proxyData.hosts ?? []);
    }
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
                  {listDatabasesError && <p className="text-xs text-red-400">{listDatabasesError}</p>}
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
            </div>
          )}
          {(form.kind === "folder" || form.kind === "sqlite") && (
            <div className="space-y-2 rounded border border-neutral-800 p-3">
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
                {r.proxyHostId && (
                  <p className="mt-0.5 text-xs text-neutral-600">
                    Failover NPM : <span className="text-neutral-400">{proxyHostLabel(r.proxyHostId)}</span>
                    {r.targetPort ? ` (port ${r.targetPort})` : ""}
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
              {r.proxyHostId && (
                <button
                  onClick={() => rewireFailover(r.id)}
                  disabled={busyId === r.id}
                  className="rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
                >
                  Rebrancher le failover
                </button>
              )}
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
