"use client";

import { useCallback, useEffect, useState } from "react";
import JobLog from "@/components/JobLog";

// Mirrors MAX_IMPORT_BYTES in lib/dbManager/dumpRestore.ts — checked here too so an oversized
// file is rejected before the browser spends any time uploading it.
const MAX_IMPORT_BYTES = 1024 * 1024 * 1024;

type Engine = "mysql" | "postgres";
type Host = { id: number; name: string };
type Connection = {
  id: string;
  hostId: number;
  label: string;
  engine: Engine;
  containerId: string | null;
  containerKind: "docker" | "incus";
  dbHost: string;
  dbPort: number;
  username: string;
};
type ColumnInfo = { name: string; dataType: string; nullable: boolean; defaultValue: string | null; isPrimaryKey: boolean };
type ColumnSpec = { name: string; type: string; nullable: boolean; defaultValue?: string | null; primaryKey?: boolean; autoIncrement?: boolean };
type QueryResult = { columns: string[]; rows: (string | null)[][]; rowCount: number };

const TYPE_PRESETS: Record<Engine, string[]> = {
  mysql: ["INT", "BIGINT", "VARCHAR(255)", "TEXT", "DECIMAL(10,2)", "BOOLEAN", "DATE", "DATETIME", "TIMESTAMP", "JSON"],
  postgres: ["INTEGER", "BIGINT", "VARCHAR(255)", "TEXT", "NUMERIC(10,2)", "BOOLEAN", "DATE", "TIMESTAMP", "JSONB", "UUID"],
};

async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Erreur.");
  return data;
}

export default function DatabasesPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [connId, setConnId] = useState<string | null>(null);
  const [databases, setDatabases] = useState<string[]>([]);
  const [dbName, setDbName] = useState<string | null>(null);
  const [tables, setTables] = useState<string[]>([]);
  const [tableName, setTableName] = useState<string | null>(null);

  const [showAddConn, setShowAddConn] = useState(false);
  const [showAddDb, setShowAddDb] = useState(false);
  const [showAddTable, setShowAddTable] = useState(false);
  const [showQuery, setShowQuery] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConnections = useCallback(async () => {
    const [connRes, hostRes] = await Promise.all([
      api<{ connections: Connection[] }>("/api/db-manager/connections"),
      api<{ hosts: Host[] }>("/api/hosts"),
    ]);
    setConnections(connRes.connections);
    setHosts(hostRes.hosts);
  }, []);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  async function openConnection(id: string) {
    setError(null);
    setConnId(id);
    setDbName(null);
    setTableName(null);
    try {
      const data = await api<{ databases: string[] }>(`/api/db-manager/connections/${id}/databases`);
      setDatabases(data.databases);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    }
  }

  async function openDatabase(db: string) {
    if (!connId) return;
    setError(null);
    setDbName(db);
    setTableName(null);
    try {
      const data = await api<{ tables: string[] }>(`/api/db-manager/connections/${connId}/databases/${encodeURIComponent(db)}/tables`);
      setTables(data.tables);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    }
  }

  async function removeConnection(id: string) {
    if (!confirm("Supprimer cette connexion ? (les bases de données elles-mêmes ne sont pas touchées)")) return;
    await api(`/api/db-manager/connections/${id}`, { method: "DELETE" });
    if (connId === id) {
      setConnId(null);
      setDbName(null);
    }
    loadConnections();
  }

  async function dropDb(db: string) {
    if (!connId) return;
    if (!confirm(`Supprimer définitivement la base "${db}" et toutes ses données ?`)) return;
    try {
      await api(`/api/db-manager/connections/${connId}/databases/${encodeURIComponent(db)}`, { method: "DELETE" });
      openConnection(connId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    }
  }

  async function dropTbl(table: string) {
    if (!connId || !dbName) return;
    if (!confirm(`Supprimer définitivement la table "${table}" et toutes ses données ?`)) return;
    try {
      await api(`/api/db-manager/connections/${connId}/databases/${encodeURIComponent(dbName)}/tables/${encodeURIComponent(table)}`, {
        method: "DELETE",
      });
      openDatabase(dbName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    }
  }

  const connection = connections.find((c) => c.id === connId) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Bases de données</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Gestionnaire MySQL/MariaDB/PostgreSQL intégré — connexions, bases, tables, données et requêtes SQL, via SSH
          sur vos machines gérées (pas de port de base de données à exposer).
        </p>
      </div>

      {error && (
        <div className="whitespace-pre-line rounded border border-red-900 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-start gap-4">
        <ConnectionTree
          connections={connections}
          connId={connId}
          databases={databases}
          dbName={dbName}
          onOpenConnection={openConnection}
          onOpenDatabase={openDatabase}
          onRemoveConnection={removeConnection}
          onDropDatabase={dropDb}
          showAdd={showAddConn}
          onToggleAdd={() => setShowAddConn((s) => !s)}
        />

        <div className="min-w-0 flex-1 space-y-4">
          {showAddConn && (
            <AddConnectionForm
              hosts={hosts}
              onAdded={() => {
                setShowAddConn(false);
                loadConnections();
              }}
              onCancel={() => setShowAddConn(false)}
            />
          )}

          {!showAddConn && !connId && (
            <div className="rounded-xl border border-dashed border-neutral-800 p-8 text-center text-sm text-neutral-500">
              Sélectionne une connexion à gauche, ou crée-en une nouvelle.
            </div>
          )}

          {!showAddConn && connId && !dbName && (
            <div className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <p className="text-sm text-neutral-400">Sélectionne une base dans l&apos;arborescence, ou crée-en une nouvelle sur cette connexion.</p>
              <AddDatabaseInline
                onAdd={async (name) => {
                  await api(`/api/db-manager/connections/${connId}/databases`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name }),
                  });
                  openConnection(connId);
                }}
              />
            </div>
          )}

          {connId && dbName && !tableName && connection && (
            <TablesList
              tables={tables}
              engine={connection.engine}
              onOpen={setTableName}
              onDrop={dropTbl}
              showAddTable={showAddTable}
              setShowAddTable={setShowAddTable}
              showQuery={showQuery}
              setShowQuery={setShowQuery}
              onCreateTable={async (name, columns) => {
                await api(`/api/db-manager/connections/${connId}/databases/${encodeURIComponent(dbName)}/tables`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name, columns }),
                });
                setShowAddTable(false);
                openDatabase(dbName);
              }}
              connId={connId}
              dbName={dbName}
              connections={connections}
            />
          )}

          {connId && dbName && tableName && connection && (
            <TableDetail connId={connId} dbName={dbName} tableName={tableName} engine={connection.engine} onDropped={() => openDatabase(dbName)} />
          )}
        </div>
      </div>
    </div>
  );
}

function ConnectionTree({
  connections,
  connId,
  databases,
  dbName,
  onOpenConnection,
  onOpenDatabase,
  onRemoveConnection,
  onDropDatabase,
  showAdd,
  onToggleAdd,
}: {
  connections: Connection[];
  connId: string | null;
  databases: string[];
  dbName: string | null;
  onOpenConnection: (id: string) => void;
  onOpenDatabase: (db: string) => void;
  onRemoveConnection: (id: string) => void;
  onDropDatabase: (db: string) => void;
  showAdd: boolean;
  onToggleAdd: () => void;
}) {
  return (
    <aside className="w-full shrink-0 space-y-1 rounded-xl border border-neutral-800 bg-neutral-900 p-3 sm:w-64">
      <div className="flex items-center justify-between px-1 pb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Connexions</span>
        <button onClick={onToggleAdd} className={`text-xs font-medium hover:underline ${showAdd ? "text-neutral-300" : "text-blue-400"}`}>
          {showAdd ? "Annuler" : "+ Nouvelle"}
        </button>
      </div>
      {connections.length === 0 && <p className="px-1 text-xs text-neutral-600">Aucune connexion.</p>}
      {connections.map((c) => (
        <div key={c.id}>
          <div className="group flex items-center gap-1">
            <button
              onClick={() => onOpenConnection(c.id)}
              className={`flex-1 truncate rounded-lg px-2 py-1.5 text-left text-sm ${
                connId === c.id ? "bg-blue-900/30 font-medium text-blue-200" : "text-neutral-300 hover:bg-neutral-800"
              }`}
            >
              {c.label}
            </button>
            <button
              onClick={() => onRemoveConnection(c.id)}
              className="rounded px-1.5 py-1 text-xs text-neutral-600 opacity-0 hover:bg-red-950/40 hover:text-red-300 group-hover:opacity-100"
              aria-label={`Supprimer la connexion ${c.label}`}
            >
              ✕
            </button>
          </div>
          {connId === c.id && (
            <div className="ml-2 space-y-0.5 border-l border-neutral-800 pl-2">
              {databases.map((db) => (
                <div key={db} className="group flex items-center gap-1">
                  <button
                    onClick={() => onOpenDatabase(db)}
                    className={`flex-1 truncate rounded-lg px-2 py-1 text-left font-mono text-xs ${
                      dbName === db ? "bg-blue-900/30 font-medium text-blue-200" : "text-neutral-400 hover:bg-neutral-800"
                    }`}
                  >
                    {db}
                  </button>
                  <button
                    onClick={() => onDropDatabase(db)}
                    className="rounded px-1 py-1 text-xs text-neutral-600 opacity-0 hover:bg-red-950/40 hover:text-red-300 group-hover:opacity-100"
                    aria-label={`Supprimer la base ${db}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {databases.length === 0 && <p className="px-2 py-1 text-xs text-neutral-600">Aucune base.</p>}
            </div>
          )}
        </div>
      ))}
    </aside>
  );
}

function AddDatabaseInline({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <div className="flex gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="nom_de_la_base" className="input flex-1" />
      <button
        onClick={() => {
          if (name.trim()) onAdd(name.trim());
          setName("");
        }}
        className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-900/60"
      >
        Créer
      </button>
    </div>
  );
}

function AddConnectionForm({
  hosts,
  onAdded,
  onCancel,
}: {
  hosts: Host[];
  onAdded: () => void;
  onCancel: () => void;
}) {
  const [hostId, setHostId] = useState<number | "">("");
  const [label, setLabel] = useState("");
  const [engine, setEngine] = useState<Engine>("mysql");
  const [containerId, setContainerId] = useState("");
  const [containerKind, setContainerKind] = useState<"docker" | "incus">("docker");
  const [dbHost, setDbHost] = useState("127.0.0.1");
  const [dbPort, setDbPort] = useState(3306);
  const [username, setUsername] = useState("root");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!hostId || !label.trim() || !username.trim() || !password) return;
    setSaving(true);
    setErr(null);
    try {
      await api("/api/db-manager/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostId, label, engine, containerId: containerId || null, containerKind, dbHost, dbPort, username, password }),
      });
      onAdded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-sm font-semibold text-neutral-100">Nouvelle connexion</h2>
      {err && <p className="text-sm text-red-400">{err}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Machine (SSH)">
          <select value={hostId} onChange={(e) => setHostId(e.target.value ? Number(e.target.value) : "")} className="input">
            <option value="">Sélectionner...</option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Nom (libre)">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="MariaDB Mailcow" className="input" />
        </Field>
        <Field label="Moteur">
          <select
            value={engine}
            onChange={(e) => {
              const v = e.target.value as Engine;
              setEngine(v);
              setDbPort(v === "mysql" ? 3306 : 5432);
              setUsername(v === "mysql" ? "root" : "postgres");
            }}
            className="input"
          >
            <option value="mysql">MySQL / MariaDB</option>
            <option value="postgres">PostgreSQL</option>
          </select>
        </Field>
        <Field label="Conteneur (optionnel)">
          <input
            value={containerId}
            onChange={(e) => setContainerId(e.target.value)}
            placeholder={containerKind === "incus" ? "nom de l'instance Incus" : "mailcow-mysql-mailcow-1"}
            className="input"
          />
        </Field>
        <Field label="Type de conteneur">
          <select value={containerKind} onChange={(e) => setContainerKind(e.target.value as "docker" | "incus")} className="input">
            <option value="docker">Docker</option>
            <option value="incus">Incus</option>
          </select>
        </Field>
        <Field label="Hôte de la base">
          <input value={dbHost} onChange={(e) => setDbHost(e.target.value)} className="input" />
        </Field>
        <Field label="Port">
          <input type="number" value={dbPort} onChange={(e) => setDbPort(Number(e.target.value))} className="input" />
        </Field>
        <Field label="Utilisateur">
          <input value={username} onChange={(e) => setUsername(e.target.value)} className="input" />
        </Field>
        <Field label="Mot de passe">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input" />
        </Field>
      </div>
      <div className="flex gap-2">
        <button onClick={submit} disabled={saving} className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-900/60 disabled:opacity-50">
          {saving ? "Connexion..." : "Ajouter"}
        </button>
        <button onClick={onCancel} className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800">
          Annuler
        </button>
      </div>
      <style jsx global>{`.input { border-radius: 0.25rem; border: 1px solid rgb(64 64 64); background: rgb(10 10 10); padding: 0.375rem 0.5rem; font-size: 0.875rem; color: rgb(245 245 245); width: 100%; }`}</style>
    </div>
  );
}

function TablesList({
  tables,
  engine,
  onOpen,
  onDrop,
  showAddTable,
  setShowAddTable,
  showQuery,
  setShowQuery,
  onCreateTable,
  connId,
  dbName,
  connections,
}: {
  tables: string[];
  engine: Engine;
  onOpen: (t: string) => void;
  onDrop: (t: string) => void;
  showAddTable: boolean;
  setShowAddTable: (v: boolean) => void;
  showQuery: boolean;
  setShowQuery: (v: boolean) => void;
  onCreateTable: (name: string, columns: ColumnSpec[]) => void;
  connId: string;
  dbName: string;
  connections: Connection[];
}) {
  const [showMigrate, setShowMigrate] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-100">Tables</h2>
        <div className="flex gap-2">
          <DumpButton connId={connId} dbName={dbName} />
          <RestoreButton connId={connId} dbName={dbName} />
          <button onClick={() => setShowMigrate(!showMigrate)} className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800">
            Migrer vers...
          </button>
          <button onClick={() => setShowQuery(!showQuery)} className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800">
            Requête SQL
          </button>
          <button onClick={() => setShowAddTable(!showAddTable)} className="rounded border border-blue-700 bg-blue-900/40 px-2 py-1 text-xs text-blue-200 hover:bg-blue-900/60">
            + Nouvelle table
          </button>
        </div>
      </div>

      {showMigrate && (
        <MigratePanel connId={connId} dbName={dbName} engine={engine} connections={connections} onClose={() => setShowMigrate(false)} />
      )}
      {showQuery && <QueryEditor connId={connId} dbName={dbName} />}
      {showAddTable && <CreateTableForm engine={engine} onCreate={onCreateTable} />}

      <div className="divide-y divide-neutral-800 rounded border border-neutral-800">
        {tables.map((t) => (
          <div key={t} className="flex items-center justify-between px-3 py-2 text-sm">
            <button onClick={() => onOpen(t)} className="font-mono text-neutral-100 hover:text-blue-300">{t}</button>
            <button onClick={() => onDrop(t)} className="rounded border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40">
              Supprimer
            </button>
          </div>
        ))}
        {tables.length === 0 && <p className="p-4 text-center text-sm text-neutral-600">Aucune table.</p>}
      </div>
    </div>
  );
}

function MigratePanel({
  connId,
  dbName,
  engine,
  connections,
  onClose,
}: {
  connId: string;
  dbName: string;
  engine: Engine;
  connections: Connection[];
  onClose: () => void;
}) {
  const targets = connections.filter((c) => c.id !== connId && c.engine === engine);
  const [targetConnId, setTargetConnId] = useState("");
  const [targetDatabases, setTargetDatabases] = useState<string[]>([]);
  const [targetDatabase, setTargetDatabase] = useState("");
  const [newDbName, setNewDbName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  useEffect(() => {
    if (!targetConnId) {
      setTargetDatabases([]);
      return;
    }
    api<{ databases: string[] }>(`/api/db-manager/connections/${targetConnId}/databases`)
      .then((d) => setTargetDatabases(d.databases))
      .catch(() => setTargetDatabases([]));
  }, [targetConnId]);

  async function launch() {
    const finalTarget = newDbName.trim() || targetDatabase;
    if (!targetConnId || !finalTarget) return;
    if (!confirm(`Migrer "${dbName}" vers "${finalTarget}" sur l'autre connexion ? Les données existantes de la base cible seront écrasées en cas de conflit.`))
      return;
    setBusy(true);
    setError(null);
    try {
      if (newDbName.trim() && !targetDatabases.includes(newDbName.trim())) {
        await api(`/api/db-manager/connections/${targetConnId}/databases`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newDbName.trim() }),
        });
      }
      const data = await api<{ jobId: string }>("/api/db-manager/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceConnectionId: connId,
          sourceDatabase: dbName,
          targetConnectionId: targetConnId,
          targetDatabase: finalTarget,
        }),
      });
      setJobId(data.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors du lancement de la migration.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded border border-neutral-800 bg-neutral-900 p-3">
      <p className="text-xs text-neutral-400">
        Transfère &quot;{dbName}&quot; directement vers une autre connexion (serveur A → serveur B), sans passer par ton navigateur.
      </p>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {jobId ? (
        <div className="w-full max-w-sm rounded border border-neutral-800 bg-neutral-950 p-2">
          <JobLog jobId={jobId} />
          <button onClick={onClose} className="mt-2 text-xs text-neutral-400 hover:underline">
            Fermer
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label="Connexion cible">
            <select value={targetConnId} onChange={(e) => setTargetConnId(e.target.value)} className="input">
              <option value="">Sélectionner...</option>
              {targets.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Base cible existante (ou saisis un nouveau nom ci-dessous)">
            <select value={targetDatabase} onChange={(e) => setTargetDatabase(e.target.value)} className="input" disabled={!targetConnId}>
              <option value="">Sélectionner...</option>
              {targetDatabases.map((db) => (
                <option key={db} value={db}>
                  {db}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ou nouvelle base à créer sur la cible">
            <input value={newDbName} onChange={(e) => setNewDbName(e.target.value)} placeholder={dbName} className="input" />
          </Field>
          <div className="flex items-end gap-2">
            <button
              onClick={launch}
              disabled={busy || !targetConnId || !(newDbName.trim() || targetDatabase)}
              className="rounded border border-emerald-700 bg-emerald-900/40 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-900/60 disabled:opacity-50"
            >
              {busy ? "Lancement..." : "Lancer la migration"}
            </button>
            <button onClick={onClose} className="text-xs text-neutral-400 hover:underline">
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DumpButton({ connId, dbName }: { connId: string; dbName: string }) {
  // A plain link to the streaming export route — the browser downloads it natively (its own
  // progress UI, no risk of buffering a near-1GB export as one in-memory blob first).
  return (
    <a
      href={`/api/db-manager/connections/${connId}/databases/${encodeURIComponent(dbName)}/dump`}
      className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
    >
      Exporter
    </a>
  );
}

function RestoreButton({ connId, dbName }: { connId: string; dbName: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    if (file.size > MAX_IMPORT_BYTES) {
      setError(`Fichier trop volumineux (${(file.size / 1024 / 1024).toFixed(0)} Mo, maximum 1024 Mo).`);
      return;
    }
    if (!confirm(`Importer "${file.name}" dans la base "${dbName}" ? Cela peut écraser des données existantes.`)) return;
    setBusy(true);
    try {
      // The raw file bytes go straight into the request body — no base64, which would add 33%
      // and risk the browser choking on a ~1GB string for nothing. The server pipes them
      // directly into mysql/psql's stdin over SSH, decompressing on the remote end if gzipped.
      const res = await fetch(
        `/api/db-manager/connections/${connId}/databases/${encodeURIComponent(dbName)}/restore`,
        {
          method: "POST",
          headers: { "X-Is-Gzip": file.name.endsWith(".gz") ? "1" : "0" },
          body: file,
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur lors de la restauration.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de la restauration.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-block">
      <label className="cursor-pointer rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800">
        {busy ? "Import en cours..." : "Importer"}
        <input type="file" accept=".sql,.gz" onChange={onFile} disabled={busy} className="hidden" />
      </label>
      {error && <p className="mt-1 max-w-xs text-xs text-red-400">{error}</p>}
    </div>
  );
}

function QueryEditor({ connId, dbName }: { connId: string; dbName: string }) {
  const [sql, setSql] = useState("SELECT 1;");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    setErr(null);
    setResult(null);
    try {
      const data = await api<QueryResult>(`/api/db-manager/connections/${connId}/databases/${encodeURIComponent(dbName)}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql }),
      });
      setResult(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-2 rounded border border-neutral-800 bg-neutral-900 p-3">
      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        rows={5}
        className="w-full rounded border border-neutral-700 bg-neutral-950 p-2 font-mono text-xs text-neutral-100"
        spellCheck={false}
      />
      <button onClick={run} disabled={running} className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-900/60 disabled:opacity-50">
        {running ? "Exécution..." : "Exécuter"}
      </button>
      {err && <p className="text-sm text-red-400">{err}</p>}
      {result && <ResultTable columns={result.columns} rows={result.rows} />}
    </div>
  );
}

function ResultTable({ columns, rows }: { columns: string[]; rows: (string | null)[][] }) {
  if (columns.length === 0) return <p className="text-sm text-neutral-500">Terminé (aucune donnée retournée).</p>;
  return (
    <div className="max-h-96 overflow-auto rounded border border-neutral-800">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-neutral-900 text-left text-neutral-500">
          <tr>
            {columns.map((c) => (
              <th key={c} className="px-2 py-1.5 font-medium">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-neutral-900">
              {row.map((cell, j) => (
                <td key={j} className="max-w-xs truncate px-2 py-1.5 text-neutral-300" title={cell ?? ""}>
                  {cell === null ? <span className="italic text-neutral-600">NULL</span> : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CreateTableForm({ engine, onCreate }: { engine: Engine; onCreate: (name: string, columns: ColumnSpec[]) => void }) {
  const [name, setName] = useState("");
  const [columns, setColumns] = useState<ColumnSpec[]>([{ name: "id", type: engine === "mysql" ? "INT" : "INTEGER", nullable: false, primaryKey: true, autoIncrement: true }]);

  function updateCol(i: number, patch: Partial<ColumnSpec>) {
    setColumns((cols) => cols.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  return (
    <div className="space-y-3 rounded border border-neutral-800 bg-neutral-900 p-4">
      <Field label="Nom de la table">
        <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
      </Field>
      <div className="space-y-2">
        {columns.map((col, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded border border-neutral-800 p-2">
            <input value={col.name} onChange={(e) => updateCol(i, { name: e.target.value })} placeholder="nom_colonne" className="input w-36" />
            <input
              value={col.type}
              onChange={(e) => updateCol(i, { type: e.target.value })}
              list={`types-${i}`}
              placeholder="type"
              className="input w-40"
            />
            <datalist id={`types-${i}`}>
              {TYPE_PRESETS[engine].map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <label className="flex items-center gap-1 text-xs text-neutral-400">
              <input type="checkbox" checked={!col.nullable} onChange={(e) => updateCol(i, { nullable: !e.target.checked })} /> Requis
            </label>
            <label className="flex items-center gap-1 text-xs text-neutral-400">
              <input type="checkbox" checked={!!col.primaryKey} onChange={(e) => updateCol(i, { primaryKey: e.target.checked })} /> Clé primaire
            </label>
            <label className="flex items-center gap-1 text-xs text-neutral-400">
              <input type="checkbox" checked={!!col.autoIncrement} onChange={(e) => updateCol(i, { autoIncrement: e.target.checked })} /> Auto-incrément
            </label>
            <input
              value={col.defaultValue ?? ""}
              onChange={(e) => updateCol(i, { defaultValue: e.target.value })}
              placeholder="défaut (optionnel)"
              className="input w-32"
            />
            <button onClick={() => setColumns((cols) => cols.filter((_, idx) => idx !== i))} className="ml-auto text-xs text-red-400 hover:underline">
              Retirer
            </button>
          </div>
        ))}
        <button
          onClick={() => setColumns((cols) => [...cols, { name: "", type: "VARCHAR(255)", nullable: true }])}
          className="text-xs text-blue-400 hover:underline"
        >
          + Ajouter une colonne
        </button>
      </div>
      <button
        onClick={() => name.trim() && columns.every((c) => c.name.trim() && c.type.trim()) && onCreate(name.trim(), columns)}
        className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-900/60"
      >
        Créer la table
      </button>
    </div>
  );
}

function TableDetail({
  connId,
  dbName,
  tableName,
  engine,
  onDropped,
}: {
  connId: string;
  dbName: string;
  tableName: string;
  engine: Engine;
  onDropped: () => void;
}) {
  const [tab, setTab] = useState<"data" | "structure">("data");
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [rows, setRows] = useState<(string | null)[][]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<(string | null)[] | null>(null);
  const [showAddRow, setShowAddRow] = useState(false);
  const [showAddCol, setShowAddCol] = useState(false);

  const base = `/api/db-manager/connections/${connId}/databases/${encodeURIComponent(dbName)}/tables/${encodeURIComponent(tableName)}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ columns: ColumnInfo[]; rows: (string | null)[][]; total: number }>(`${base}/rows?page=${page}`);
      setColumns(data.columns);
      setRows(data.rows);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur.");
    } finally {
      setLoading(false);
    }
  }, [base, page]);

  useEffect(() => {
    load();
  }, [load]);

  const pkColumns = columns.filter((c) => c.isPrimaryKey);

  function pkFromRow(row: (string | null)[]): Record<string, string | null> {
    const pk: Record<string, string | null> = {};
    for (const c of pkColumns) pk[c.name] = row[columns.findIndex((cc) => cc.name === c.name)];
    return pk;
  }

  async function deleteRow(row: (string | null)[]) {
    if (pkColumns.length === 0) return alert("Cette table n'a pas de clé primaire, suppression impossible depuis cette vue.");
    if (!confirm("Supprimer cette ligne ?")) return;
    try {
      await api(`${base}/rows`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ primaryKey: pkFromRow(row) }) });
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erreur.");
    }
  }

  async function dropColumn(name: string) {
    if (!confirm(`Supprimer la colonne "${name}" ?`)) return;
    try {
      await api(`${base}/columns/${encodeURIComponent(name)}`, { method: "DELETE" });
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erreur.");
    }
  }

  async function dropThisTable() {
    if (!confirm(`Supprimer définitivement la table "${tableName}" ?`)) return;
    try {
      await api(base, { method: "DELETE" });
      onDropped();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erreur.");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5 text-xs">
          <button onClick={() => setTab("data")} className={`rounded border px-2 py-1 ${tab === "data" ? "border-blue-700 bg-blue-900/40 text-blue-200" : "border-neutral-700 text-neutral-400 hover:bg-neutral-800"}`}>
            Données ({total})
          </button>
          <button onClick={() => setTab("structure")} className={`rounded border px-2 py-1 ${tab === "structure" ? "border-blue-700 bg-blue-900/40 text-blue-200" : "border-neutral-700 text-neutral-400 hover:bg-neutral-800"}`}>
            Structure
          </button>
        </div>
        <button onClick={dropThisTable} className="rounded border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40">
          Supprimer la table
        </button>
      </div>

      {error && <p className="whitespace-pre-line text-sm text-red-400">{error}</p>}

      {tab === "structure" && (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900 text-left text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Colonne</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Nullable</th>
                  <th className="px-3 py-2 font-medium">Défaut</th>
                  <th className="px-3 py-2 font-medium">Clé</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {columns.map((c) => (
                  <tr key={c.name} className="border-t border-neutral-900">
                    <td className="px-3 py-2 font-mono text-neutral-100">{c.name}</td>
                    <td className="px-3 py-2 text-neutral-400">{c.dataType}</td>
                    <td className="px-3 py-2 text-neutral-400">{c.nullable ? "Oui" : "Non"}</td>
                    <td className="px-3 py-2 text-neutral-500">{c.defaultValue ?? "—"}</td>
                    <td className="px-3 py-2 text-neutral-400">{c.isPrimaryKey ? "PRI" : ""}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => dropColumn(c.name)} className="text-xs text-red-400 hover:underline">Supprimer</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={() => setShowAddCol(!showAddCol)} className="rounded border border-blue-700 bg-blue-900/40 px-2 py-1 text-xs text-blue-200 hover:bg-blue-900/60">
            + Ajouter une colonne
          </button>
          {showAddCol && (
            <AddColumnForm
              engine={engine}
              onAdd={async (col) => {
                await api(`${base}/columns`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(col) });
                setShowAddCol(false);
                load();
              }}
            />
          )}
        </div>
      )}

      {tab === "data" && (
        <div className="space-y-2">
          <button onClick={() => setShowAddRow(!showAddRow)} className="rounded border border-blue-700 bg-blue-900/40 px-2 py-1 text-xs text-blue-200 hover:bg-blue-900/60">
            + Ajouter une ligne
          </button>
          {showAddRow && (
            <RowForm
              columns={columns}
              initial={null}
              onSubmit={async (values) => {
                await api(`${base}/rows`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values }) });
                setShowAddRow(false);
                load();
              }}
              onCancel={() => setShowAddRow(false)}
            />
          )}
          {loading ? (
            <p className="text-sm text-neutral-500">Chargement...</p>
          ) : (
            <div className="overflow-x-auto rounded border border-neutral-800">
              <table className="w-full text-xs">
                <thead className="bg-neutral-900 text-left text-neutral-500">
                  <tr>
                    {columns.map((c) => (
                      <th key={c.name} className="px-2 py-1.5 font-medium">{c.name}</th>
                    ))}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} className="border-t border-neutral-900">
                      {row.map((cell, j) => (
                        <td key={j} className="max-w-xs truncate px-2 py-1.5 text-neutral-300" title={cell ?? ""}>
                          {cell === null ? <span className="italic text-neutral-600">NULL</span> : cell}
                        </td>
                      ))}
                      <td className="whitespace-nowrap px-2 py-1.5 text-right">
                        <button onClick={() => setEditRow(row)} className="mr-2 text-blue-400 hover:underline">Éditer</button>
                        <button onClick={() => deleteRow(row)} className="text-red-400 hover:underline">Suppr.</button>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={columns.length + 1} className="px-3 py-6 text-center text-neutral-600">
                        Aucune ligne.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span>{total} ligne{total > 1 ? "s" : ""} — page {page + 1}</span>
            <div className="flex gap-2">
              <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded border border-neutral-700 px-2 py-1 disabled:opacity-40">Précédent</button>
              <button disabled={(page + 1) * 100 >= total} onClick={() => setPage((p) => p + 1)} className="rounded border border-neutral-700 px-2 py-1 disabled:opacity-40">Suivant</button>
            </div>
          </div>
        </div>
      )}

      {editRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setEditRow(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded border border-neutral-800 bg-neutral-900 p-4">
            <h3 className="mb-3 text-sm font-semibold text-neutral-100">Éditer la ligne</h3>
            <RowForm
              columns={columns}
              initial={editRow}
              onSubmit={async (values) => {
                if (pkColumns.length === 0) return alert("Pas de clé primaire, édition impossible.");
                await api(`${base}/rows`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ primaryKey: pkFromRow(editRow), values }),
                });
                setEditRow(null);
                load();
              }}
              onCancel={() => setEditRow(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function AddColumnForm({ engine, onAdd }: { engine: Engine; onAdd: (c: ColumnSpec) => void }) {
  const [col, setCol] = useState<ColumnSpec>({ name: "", type: TYPE_PRESETS[engine][0], nullable: true });
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-neutral-800 bg-neutral-900 p-3">
      <input value={col.name} onChange={(e) => setCol({ ...col, name: e.target.value })} placeholder="nom_colonne" className="input w-36" />
      <input value={col.type} onChange={(e) => setCol({ ...col, type: e.target.value })} list="add-col-types" placeholder="type" className="input w-40" />
      <datalist id="add-col-types">
        {TYPE_PRESETS[engine].map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <label className="flex items-center gap-1 text-xs text-neutral-400">
        <input type="checkbox" checked={!col.nullable} onChange={(e) => setCol({ ...col, nullable: !e.target.checked })} /> Requis
      </label>
      <input value={col.defaultValue ?? ""} onChange={(e) => setCol({ ...col, defaultValue: e.target.value })} placeholder="défaut (optionnel)" className="input w-32" />
      <button
        onClick={() => col.name.trim() && col.type.trim() && onAdd(col)}
        className="rounded border border-blue-700 bg-blue-900/40 px-2 py-1 text-xs text-blue-200 hover:bg-blue-900/60"
      >
        Ajouter
      </button>
    </div>
  );
}

function RowForm({
  columns,
  initial,
  onSubmit,
  onCancel,
}: {
  columns: ColumnInfo[];
  initial: (string | null)[] | null;
  onSubmit: (values: Record<string, string | null>) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string | null>>(() => {
    const v: Record<string, string | null> = {};
    columns.forEach((c, i) => (v[c.name] = initial ? initial[i] : null));
    return v;
  });

  return (
    <div className="space-y-2 rounded border border-neutral-800 bg-neutral-900 p-3">
      {columns.map((c) => (
        <div key={c.name} className="flex items-center gap-2">
          <label className="w-32 shrink-0 truncate text-xs text-neutral-400" title={c.name}>
            {c.name}
            {c.isPrimaryKey && <span className="text-neutral-600"> (PK)</span>}
          </label>
          <input
            value={values[c.name] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [c.name]: e.target.value }))}
            placeholder={c.nullable ? "NULL" : ""}
            className="input flex-1"
          />
          <label className="flex shrink-0 items-center gap-1 text-xs text-neutral-500">
            <input type="checkbox" checked={values[c.name] === null} onChange={(e) => setValues((v) => ({ ...v, [c.name]: e.target.checked ? null : "" }))} /> NULL
          </label>
        </div>
      ))}
      <div className="flex gap-2 pt-1">
        <button onClick={() => onSubmit(values)} className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-900/60">
          Enregistrer
        </button>
        <button onClick={onCancel} className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800">
          Annuler
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-neutral-500">{label}</label>
      {children}
    </div>
  );
}
