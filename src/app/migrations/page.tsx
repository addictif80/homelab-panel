"use client";

import { useEffect, useState } from "react";
import JobLog from "@/components/JobLog";

type Host = { id: number; name: string; kind: string; incus_enabled?: number };
type IncusInstance = { name: string; status: string; hostId: number };
type DbConnection = { id: string; hostId: number; label: string; containerId: string | null; containerKind: "docker" | "incus" };
type DbDump = { db: string; date: string; file: string; memberPath: string };
type SiteInfo = { domains: string[]; databases: DbDump[] };

const INPUT = "w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100";
const DEFAULT_EXCLUDES = "*/wp-content/debug.log";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-neutral-400">{label}</span>
      {children}
    </label>
  );
}

async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Erreur.");
  return data;
}

export default function MigrationsPage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [dbConnections, setDbConnections] = useState<DbConnection[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Source (NAS)
  const [nasHostId, setNasHostId] = useState<number | "">("");
  const [backupRoot, setBackupRoot] = useState("");
  const [sites, setSites] = useState<string[]>([]);
  const [site, setSite] = useState<string | null>(null);
  const [siteInfo, setSiteInfo] = useState<SiteInfo | null>(null);
  const [domain, setDomain] = useState("");
  const [loadingSites, setLoadingSites] = useState(false);
  const [loadingSiteInfo, setLoadingSiteInfo] = useState(false);

  // Target (CyberPanel / Incus)
  const [targetHostId, setTargetHostId] = useState<number | "">("");
  const [incusInstances, setIncusInstances] = useState<IncusInstance[]>([]);
  const [targetContainerId, setTargetContainerId] = useState("");
  const [targetDomain, setTargetDomain] = useState("");
  const [excludePatterns, setExcludePatterns] = useState(DEFAULT_EXCLUDES);
  const [wipeFirst, setWipeFirst] = useState(true);

  // Database (optional)
  const [restoreDb, setRestoreDb] = useState(true);
  const [selectedDump, setSelectedDump] = useState<string>(""); // memberPath
  const [dbConnectionId, setDbConnectionId] = useState("");
  const [targetDatabases, setTargetDatabases] = useState<string[]>([]);
  const [targetDatabase, setTargetDatabase] = useState("");

  const [jobId, setJobId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    api<{ hosts: Host[] }>("/api/hosts").then((d) => setHosts(d.hosts));
    api<{ connections: DbConnection[] }>("/api/db-manager/connections").then((d) => setDbConnections(d.connections));
  }, []);

  useEffect(() => {
    if (!targetHostId) {
      setIncusInstances([]);
      return;
    }
    api<{ instances: IncusInstance[] }>("/api/incus/instances")
      .then((d) => setIncusInstances(d.instances.filter((i) => i.hostId === targetHostId && i.status === "Running")))
      .catch(() => setIncusInstances([]));
  }, [targetHostId]);

  useEffect(() => {
    if (!dbConnectionId) {
      setTargetDatabases([]);
      return;
    }
    api<{ databases: string[] }>(`/api/db-manager/connections/${dbConnectionId}/databases`)
      .then((d) => setTargetDatabases(d.databases))
      .catch(() => setTargetDatabases([]));
  }, [dbConnectionId]);

  async function loadSites() {
    if (!nasHostId || !backupRoot.trim()) return;
    setError(null);
    setLoadingSites(true);
    setSites([]);
    setSite(null);
    setSiteInfo(null);
    try {
      const d = await api<{ sites: string[] }>(`/api/migration/cloudpanel/sites?hostId=${nasHostId}&root=${encodeURIComponent(backupRoot)}`);
      setSites(d.sites);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setLoadingSites(false);
    }
  }

  async function openSite(s: string) {
    if (!nasHostId) return;
    setError(null);
    setSite(s);
    setSiteInfo(null);
    setLoadingSiteInfo(true);
    try {
      const info = await api<SiteInfo>(
        `/api/migration/cloudpanel/sites/${encodeURIComponent(s)}/inspect?hostId=${nasHostId}&root=${encodeURIComponent(backupRoot)}`
      );
      setSiteInfo(info);
      const firstDomain = info.domains[0] ?? "";
      setDomain(firstDomain);
      setTargetDomain(firstDomain);
      setSelectedDump(info.databases[0]?.memberPath ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setLoadingSiteInfo(false);
    }
  }

  async function launchRestore() {
    if (!nasHostId || !site || !domain || !targetHostId || !targetContainerId || !targetDomain) return;
    if (
      !confirm(
        wipeFirst
          ? `Vider /home/${targetDomain}/public_html puis y restaurer "${domain}" ? Cette action est irréversible pour le contenu actuel.`
          : `Restaurer "${domain}" dans /home/${targetDomain}/public_html (par-dessus l'existant) ?`
      )
    )
      return;
    setError(null);
    setRestoring(true);
    try {
      const body = {
        nasHostId,
        backupRoot,
        site,
        domain,
        targetHostId,
        targetContainerId,
        targetDomain,
        excludePatterns: excludePatterns
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
        wipeFirst,
        ...(restoreDb && selectedDump && dbConnectionId && targetDatabase
          ? { dbConnectionId, targetDatabase, memberPath: selectedDump }
          : {}),
      };
      const d = await api<{ jobId: string }>("/api/migration/cloudpanel/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setJobId(d.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setRestoring(false);
    }
  }

  const ready = !!(nasHostId && site && domain && targetHostId && targetContainerId && targetDomain);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Migration CloudPanel → CyberPanel</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Restaure en un clic les fichiers d&apos;un site et sa base de données depuis une sauvegarde CloudPanel
          (backup.tar) vers un site CyberPanel existant, dans un conteneur Incus.
        </p>
      </div>

      {error && <div className="whitespace-pre-line rounded border border-red-900 bg-red-950/30 px-3 py-2 text-sm text-red-300">{error}</div>}

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-medium text-neutral-200">1. Sauvegarde source (NAS)</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Machine (NAS, SSH)">
            <select value={nasHostId} onChange={(e) => setNasHostId(e.target.value ? Number(e.target.value) : "")} className={INPUT}>
              <option value="">Sélectionner...</option>
              {hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Dossier des sauvegardes (contient un sous-dossier par site)">
            <input
              value={backupRoot}
              onChange={(e) => setBackupRoot(e.target.value)}
              placeholder="/volume1/bkp/clp/2026-10-27/17.56/home"
              className={INPUT}
            />
          </Field>
        </div>
        <button
          onClick={loadSites}
          disabled={!nasHostId || !backupRoot.trim() || loadingSites}
          className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-900/60 disabled:opacity-50"
        >
          {loadingSites ? "Recherche..." : "Lister les sites"}
        </button>

        {sites.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {sites.map((s) => (
              <button
                key={s}
                onClick={() => openSite(s)}
                className={`rounded border px-2 py-1 text-xs ${
                  site === s ? "border-blue-700 bg-blue-900/40 text-blue-200" : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {loadingSiteInfo && <p className="text-xs text-neutral-500">Lecture de l&apos;archive...</p>}
      </section>

      {siteInfo && (
        <section className="card space-y-3 p-4">
          <h2 className="text-sm font-medium text-neutral-200">2. Fichiers du site</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Domaine source (htdocs/)">
              <select value={domain} onChange={(e) => setDomain(e.target.value)} className={INPUT}>
                {siteInfo.domains.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Machine cible (héberge le conteneur Incus CyberPanel)">
              <select value={targetHostId} onChange={(e) => setTargetHostId(e.target.value ? Number(e.target.value) : "")} className={INPUT}>
                <option value="">Sélectionner...</option>
                {hosts
                  .filter((h) => h.incus_enabled)
                  .map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Conteneur Incus (CyberPanel)">
              <select value={targetContainerId} onChange={(e) => setTargetContainerId(e.target.value)} className={INPUT}>
                <option value="">Sélectionner...</option>
                {incusInstances.map((i) => (
                  <option key={i.name} value={i.name}>
                    {i.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Domaine cible (/home/<domaine>/public_html)">
              <input value={targetDomain} onChange={(e) => setTargetDomain(e.target.value)} className={INPUT} />
            </Field>
          </div>
          <Field label="Motifs à exclure (un par ligne, syntaxe tar --exclude)">
            <textarea value={excludePatterns} onChange={(e) => setExcludePatterns(e.target.value)} rows={2} className={`${INPUT} font-mono`} />
          </Field>
          <label className="flex items-center gap-2 text-xs text-neutral-400">
            <input type="checkbox" checked={wipeFirst} onChange={(e) => setWipeFirst(e.target.checked)} />
            Vider public_html avant de restaurer (recommandé — évite de mélanger avec les fichiers par défaut de CyberPanel)
          </label>
        </section>
      )}

      {siteInfo && (
        <section className="card space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-200">3. Base de données (optionnel)</h2>
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              <input type="checkbox" checked={restoreDb} onChange={(e) => setRestoreDb(e.target.checked)} />
              Importer aussi la base
            </label>
          </div>
          {restoreDb && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Dump trouvé dans la sauvegarde">
                <select value={selectedDump} onChange={(e) => setSelectedDump(e.target.value)} className={INPUT}>
                  <option value="">Sélectionner...</option>
                  {siteInfo.databases.map((d) => (
                    <option key={d.memberPath} value={d.memberPath}>
                      {d.db} — {d.date} ({d.file})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Connexion (voir /databases pour en créer une)">
                <select value={dbConnectionId} onChange={(e) => setDbConnectionId(e.target.value)} className={INPUT}>
                  <option value="">Sélectionner...</option>
                  {dbConnections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} ({c.containerKind} {c.containerId})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Base de données cible (déjà créée dans CyberPanel)">
                <select value={targetDatabase} onChange={(e) => setTargetDatabase(e.target.value)} className={INPUT} disabled={!dbConnectionId}>
                  <option value="">Sélectionner...</option>
                  {targetDatabases.map((db) => (
                    <option key={db} value={db}>
                      {db}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
        </section>
      )}

      {ready && (
        <button
          onClick={launchRestore}
          disabled={restoring || !!jobId}
          className="rounded border border-emerald-700 bg-emerald-900/40 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-900/60 disabled:opacity-50"
        >
          {restoring ? "Lancement..." : "Restaurer"}
        </button>
      )}

      {jobId && (
        <div className="card p-4">
          <JobLog
            jobId={jobId}
            onDone={() => {
              /* leave the job visible — restarting means picking a fresh site/domain anyway */
            }}
          />
          <button onClick={() => setJobId(null)} className="mt-2 text-xs text-neutral-400 hover:underline">
            Nouvelle restauration
          </button>
        </div>
      )}
    </div>
  );
}
