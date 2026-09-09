"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Host = { id: number; name: string; kind: string; docker_enabled: number; proxmox_node: string | null };
type SourceType = "paths" | "docker" | "database" | "proxmox_vm";
type Schedule = "manual" | "hourly" | "daily" | "weekly";

type BackupRun = {
  id: string;
  planId: string;
  status: "running" | "success" | "failed";
  log: string;
  snapshotPath: string | null;
  paths: string[];
  startedAt: string;
  finishedAt: string | null;
};

type BackupPlan = {
  id: string;
  name: string;
  sourceHostId: number;
  sourceType: SourceType;
  sourceConfig: string;
  destHostId: number;
  destPath: string;
  schedule: Schedule;
  retentionCount: number;
  enabled: boolean;
  hasPassword?: boolean;
  latestRun: BackupRun | null;
};

type DockerContainer = { id: string; name: string };
type ProxmoxResource = { vmid: number; node: string; type: "qemu" | "lxc"; name: string };

const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  paths: "Dossiers / fichiers",
  docker: "Volumes Docker",
  database: "Base de données",
  proxmox_vm: "VM / CT Proxmox",
};

const SCHEDULE_LABELS: Record<Schedule, string> = {
  manual: "Manuel",
  hourly: "Toutes les heures",
  daily: "Tous les jours",
  weekly: "Toutes les semaines",
};

const INPUT_CLASS = "w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100";

function statusLabel(run: BackupRun | null): { text: string; color: string } {
  if (!run) return { text: "Jamais exécuté", color: "text-neutral-500" };
  if (run.status === "running") return { text: "En cours...", color: "text-blue-400" };
  if (run.status === "success") return { text: `OK · ${new Date(`${run.startedAt}Z`).toLocaleString("fr-FR")}`, color: "text-emerald-400" };
  return { text: `Échec · ${new Date(`${run.startedAt}Z`).toLocaleString("fr-FR")}`, color: "text-red-400" };
}

export default function BackupsPage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [plans, setPlans] = useState<BackupPlan[] | null>(null);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);
  const [runHistory, setRunHistory] = useState<Record<string, BackupRun[]>>({});
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<BackupRun | null>(null);
  const [restoring, setRestoring] = useState<{ plan: BackupPlan; run: BackupRun; path: string } | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  const loadPlans = useCallback(async () => {
    const res = await fetch("/api/backups");
    const data = await res.json();
    setPlans(data.plans);
  }, []);

  useEffect(() => {
    fetch("/api/hosts")
      .then((r) => r.json())
      .then((d) => setHosts(d.hosts));
    loadPlans();
  }, [loadPlans]);

  useEffect(() => {
    if (!activeRunId) return;
    let cancelled = false;
    const poll = async () => {
      const res = await fetch(`/api/backups/runs/${activeRunId}`);
      const data = await res.json();
      if (cancelled || !data.run) return;
      setActiveRun(data.run);
      requestAnimationFrame(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
      });
      if (data.run.status === "running") setTimeout(poll, 2000);
      else loadPlans();
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [activeRunId, loadPlans]);

  async function runNow(planId: string) {
    setError("");
    try {
      const res = await fetch(`/api/backups/${planId}/run`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setActiveRunId(data.runId);
      setActiveRun({ id: data.runId, planId, status: "running", log: "", snapshotPath: null, paths: [], startedAt: new Date().toISOString(), finishedAt: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    }
  }

  async function toggleEnabled(plan: BackupPlan) {
    await fetch(`/api/backups/${plan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !plan.enabled }),
    });
    loadPlans();
  }

  async function removePlan(id: string) {
    if (!confirm("Supprimer ce plan de sauvegarde ? Les sauvegardes déjà faites restent sur la destination.")) return;
    await fetch(`/api/backups/${id}`, { method: "DELETE" });
    loadPlans();
  }

  async function loadHistory(planId: string) {
    if (expandedPlan === planId) {
      setExpandedPlan(null);
      return;
    }
    setExpandedPlan(planId);
    if (!runHistory[planId]) {
      const res = await fetch(`/api/backups/${planId}/runs`);
      const data = await res.json();
      setRunHistory((h) => ({ ...h, [planId]: data.runs }));
    }
  }

  function hostName(id: number): string {
    return hosts.find((h) => h.id === id)?.name || `#${id}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Sauvegardes</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Sauvegarde versionnée (comme Hyper Backup) de dossiers, volumes Docker, bases de données ou VM/CT Proxmox,
            transférée directement d&apos;une machine à l&apos;autre — le HP ou le Synology par exemple.
          </p>
        </div>
        <button
          onClick={() => setShowCreate((s) => !s)}
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
        >
          {showCreate ? "Annuler" : "+ Nouveau plan"}
        </button>
      </div>

      {error && <div className="rounded border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{error}</div>}

      {showCreate && (
        <CreatePlanForm
          hosts={hosts}
          onCreated={() => {
            setShowCreate(false);
            loadPlans();
          }}
          onError={setError}
        />
      )}

      <div className="space-y-3">
        {plans?.map((plan) => {
          const status = statusLabel(plan.latestRun);
          return (
            <div key={plan.id} className="rounded border border-neutral-800 bg-neutral-900">
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-neutral-100">{plan.name}</span>
                    {!plan.enabled && (
                      <span className="rounded border border-neutral-700 px-1.5 py-0 text-[10px] text-neutral-500">
                        Désactivé
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {SOURCE_TYPE_LABELS[plan.sourceType]} · {hostName(plan.sourceHostId)} → {hostName(plan.destHostId)}
                    {plan.destPath} · {SCHEDULE_LABELS[plan.schedule]} · {plan.retentionCount} versions conservées
                  </p>
                  <p className={`mt-0.5 text-xs ${status.color}`}>{status.text}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => runNow(plan.id)}
                    className="rounded border border-blue-700 bg-blue-900/40 px-2 py-1 text-xs text-blue-200 hover:bg-blue-900/60"
                  >
                    Sauvegarder maintenant
                  </button>
                  <button
                    onClick={() => loadHistory(plan.id)}
                    className="rounded border border-neutral-600 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
                  >
                    {expandedPlan === plan.id ? "Masquer" : "Historique"}
                  </button>
                  <button
                    onClick={() => toggleEnabled(plan)}
                    className="rounded border border-neutral-600 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
                  >
                    {plan.enabled ? "Désactiver" : "Activer"}
                  </button>
                  <button
                    onClick={() => removePlan(plan.id)}
                    className="rounded border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40"
                  >
                    Supprimer
                  </button>
                </div>
              </div>

              {expandedPlan === plan.id && (
                <div className="border-t border-neutral-800 p-4">
                  {!runHistory[plan.id] && <p className="text-sm text-neutral-500">Chargement...</p>}
                  {runHistory[plan.id]?.length === 0 && (
                    <p className="text-sm text-neutral-500">Aucune sauvegarde effectuée pour l&apos;instant.</p>
                  )}
                  <ul className="space-y-2">
                    {runHistory[plan.id]?.map((run) => {
                      const s = statusLabel(run);
                      return (
                        <li key={run.id} className="rounded border border-neutral-800 p-2 text-xs">
                          <div className="flex items-center justify-between">
                            <span className={s.color}>{s.text}</span>
                            {run.status === "success" && run.paths.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {run.paths.map((p) => (
                                  <button
                                    key={p}
                                    onClick={() => setRestoring({ plan, run, path: p })}
                                    className="rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-300 hover:bg-neutral-800"
                                  >
                                    Restaurer {p}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          {run.snapshotPath && <p className="mt-1 font-mono text-neutral-600">{run.snapshotPath}</p>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
        {plans?.length === 0 && <p className="text-sm text-neutral-500">Aucun plan de sauvegarde pour l&apos;instant.</p>}
      </div>

      {activeRunId && activeRun && (
        <div className="fixed bottom-4 right-4 z-40 w-full max-w-lg rounded border border-neutral-700 bg-neutral-950 shadow-xl">
          <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
            <span className="text-sm text-neutral-200">
              {activeRun.status === "running" ? "Sauvegarde en cours..." : activeRun.status === "success" ? "Sauvegarde terminée" : "Échec de la sauvegarde"}
            </span>
            <button onClick={() => setActiveRunId(null)} className="text-xs text-neutral-500 hover:text-neutral-300">
              Fermer
            </button>
          </div>
          <pre
            ref={logRef}
            className="max-h-64 overflow-auto whitespace-pre-wrap bg-black p-2 font-mono text-[11px] text-neutral-300"
          >
            {activeRun.log || "Démarrage..."}
          </pre>
        </div>
      )}

      {restoring && (
        <RestoreModal
          hosts={hosts}
          plan={restoring.plan}
          run={restoring.run}
          path={restoring.path}
          onClose={() => setRestoring(null)}
          onStarted={(runId) => {
            setRestoring(null);
            setActiveRunId(runId);
            setActiveRun({ id: runId, planId: restoring.plan.id, status: "running", log: "", snapshotPath: null, paths: [], startedAt: new Date().toISOString(), finishedAt: null });
          }}
        />
      )}
    </div>
  );
}

function RestoreModal({
  hosts,
  plan,
  run,
  path,
  onClose,
  onStarted,
}: {
  hosts: Host[];
  plan: BackupPlan;
  run: BackupRun;
  path: string;
  onClose: () => void;
  onStarted: (runId: string) => void;
}) {
  const defaultParent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) || "/" : "/";
  const [targetHostId, setTargetHostId] = useState(plan.sourceHostId);
  const [targetParentDir, setTargetParentDir] = useState(defaultParent);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setStarting(true);
    setError("");
    try {
      const res = await fetch(`/api/backups/${plan.id}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotDir: run.snapshotPath, path, targetHostId, targetParentDir }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onStarted(data.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md space-y-3 rounded border border-neutral-700 bg-neutral-950 p-4">
        <h2 className="text-sm font-semibold text-neutral-100">Restaurer</h2>
        <p className="font-mono text-xs text-neutral-500">{path}</p>
        <p className="rounded border border-amber-900 bg-amber-950/30 p-2 text-xs text-amber-300">
          Ceci écrase le contenu du dossier de destination pour ce chemin. Vérifie bien la machine et le dossier avant
          de confirmer.
        </p>
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">Machine de destination</span>
          <select value={targetHostId} onChange={(e) => setTargetHostId(Number(e.target.value))} className={INPUT_CLASS}>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">Dossier parent de destination</span>
          <input value={targetParentDir} onChange={(e) => setTargetParentDir(e.target.value)} className={INPUT_CLASS} />
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} disabled={starting} className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800">
            Annuler
          </button>
          <button
            onClick={start}
            disabled={starting}
            className="rounded border border-amber-700 bg-amber-900/40 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-900/60 disabled:opacity-50"
          >
            {starting ? "Démarrage..." : "Restaurer"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreatePlanForm({
  hosts,
  onCreated,
  onError,
}: {
  hosts: Host[];
  onCreated: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("paths");
  const [sourceHostId, setSourceHostId] = useState<number | null>(hosts[0]?.id ?? null);
  const [destHostId, setDestHostId] = useState<number | null>(hosts[0]?.id ?? null);
  const [destPath, setDestPath] = useState("/volume1/backups/homelab-panel");
  const [schedule, setSchedule] = useState<Schedule>("daily");
  const [retentionCount, setRetentionCount] = useState(7);
  const [creating, setCreating] = useState(false);

  // paths
  const [pathsText, setPathsText] = useState("/etc");

  // docker
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [selectedContainers, setSelectedContainers] = useState<Set<string>>(new Set());

  // database
  const [dbContainerId, setDbContainerId] = useState("");
  const [dbEngine, setDbEngine] = useState<"mysql" | "postgres">("mysql");
  const [dbUser, setDbUser] = useState("root");
  const [dbPassword, setDbPassword] = useState("");
  const [dbAll, setDbAll] = useState(true);
  const [dbNames, setDbNames] = useState("");

  // proxmox
  const [pveResources, setPveResources] = useState<ProxmoxResource[]>([]);
  const [selectedVmid, setSelectedVmid] = useState<number | null>(null);

  useEffect(() => {
    if (!sourceHostId) return;
    if (sourceType === "docker" || sourceType === "database") {
      fetch(`/api/docker/${sourceHostId}/containers`)
        .then((r) => r.json())
        .then((d) => setContainers(d.containers || []));
    }
    if (sourceType === "proxmox_vm") {
      fetch(`/api/proxmox/${sourceHostId}/resources`)
        .then((r) => r.json())
        .then((d) => setPveResources((d.resources || []).filter((r: { type?: string }) => r.type === "qemu" || r.type === "lxc")));
    }
  }, [sourceHostId, sourceType]);

  async function submit() {
    if (!sourceHostId || !destHostId || !name) {
      onError("Nom, machine source et machine de destination requis.");
      return;
    }

    let sourceConfig: Record<string, unknown> = {};
    let password: string | undefined;

    if (sourceType === "paths") {
      const paths = pathsText.split("\n").map((p) => p.trim()).filter(Boolean);
      if (paths.length === 0) return onError("Indique au moins un chemin.");
      sourceConfig = { paths };
    } else if (sourceType === "docker") {
      if (selectedContainers.size === 0) return onError("Sélectionne au moins un conteneur.");
      sourceConfig = { containerIds: [...selectedContainers] };
    } else if (sourceType === "database") {
      if (!dbContainerId || !dbPassword) return onError("Conteneur et mot de passe requis.");
      sourceConfig = {
        containerId: dbContainerId,
        engine: dbEngine,
        user: dbUser,
        databases: dbAll ? "all" : dbNames.split(",").map((d) => d.trim()).filter(Boolean),
      };
      password = dbPassword;
    } else if (sourceType === "proxmox_vm") {
      const resource = pveResources.find((r) => r.vmid === selectedVmid);
      if (!resource) return onError("Sélectionne une VM/CT.");
      sourceConfig = { vmid: resource.vmid, vmType: resource.type };
    }

    setCreating(true);
    try {
      const res = await fetch("/api/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          sourceHostId,
          sourceType,
          sourceConfig,
          password,
          destHostId,
          destPath,
          schedule,
          retentionCount,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-3 rounded border border-neutral-800 bg-neutral-900 p-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">Nom du plan</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex: Configs Mailcow" className={INPUT_CLASS} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">Type de sauvegarde</span>
          <select value={sourceType} onChange={(e) => setSourceType(e.target.value as SourceType)} className={INPUT_CLASS}>
            {Object.entries(SOURCE_TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">Machine source</span>
          <select value={sourceHostId ?? ""} onChange={(e) => setSourceHostId(Number(e.target.value))} className={INPUT_CLASS}>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">Machine de destination (ex: HP, DS115J)</span>
          <select value={destHostId ?? ""} onChange={(e) => setDestHostId(Number(e.target.value))} className={INPUT_CLASS}>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 block">
          <span className="mb-1 block text-xs text-neutral-400">Dossier de destination</span>
          <input value={destPath} onChange={(e) => setDestPath(e.target.value)} className={INPUT_CLASS} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">Fréquence</span>
          <select value={schedule} onChange={(e) => setSchedule(e.target.value as Schedule)} className={INPUT_CLASS}>
            {Object.entries(SCHEDULE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">Versions à conserver</span>
          <input
            type="number"
            min={1}
            value={retentionCount}
            onChange={(e) => setRetentionCount(Number(e.target.value))}
            className={INPUT_CLASS}
          />
        </label>
      </div>

      {sourceType === "paths" && (
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">Chemins à sauvegarder (un par ligne)</span>
          <textarea
            value={pathsText}
            onChange={(e) => setPathsText(e.target.value)}
            rows={3}
            className={`${INPUT_CLASS} font-mono`}
          />
        </label>
      )}

      {sourceType === "docker" && (
        <div>
          <span className="mb-1 block text-xs text-neutral-400">Conteneurs (volumes nommés inclus automatiquement)</span>
          <div className="max-h-40 overflow-auto rounded border border-neutral-800">
            {containers.map((c) => (
              <label key={c.id} className="flex items-center gap-2 border-b border-neutral-900 px-2 py-1 text-sm last:border-b-0">
                <input
                  type="checkbox"
                  checked={selectedContainers.has(c.id)}
                  onChange={(e) => {
                    const next = new Set(selectedContainers);
                    if (e.target.checked) next.add(c.id);
                    else next.delete(c.id);
                    setSelectedContainers(next);
                  }}
                />
                {c.name}
              </label>
            ))}
            {containers.length === 0 && <p className="p-2 text-xs text-neutral-600">Aucun conteneur sur cette machine.</p>}
          </div>
        </div>
      )}

      {sourceType === "database" && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Conteneur de la base de données</span>
            <select value={dbContainerId} onChange={(e) => setDbContainerId(e.target.value)} className={INPUT_CLASS}>
              <option value="">— choisir —</option>
              {containers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Moteur</span>
            <select value={dbEngine} onChange={(e) => setDbEngine(e.target.value as "mysql" | "postgres")} className={INPUT_CLASS}>
              <option value="mysql">MySQL / MariaDB</option>
              <option value="postgres">PostgreSQL</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Utilisateur</span>
            <input value={dbUser} onChange={(e) => setDbUser(e.target.value)} className={INPUT_CLASS} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Mot de passe</span>
            <input type="password" value={dbPassword} onChange={(e) => setDbPassword(e.target.value)} className={INPUT_CLASS} />
          </label>
          <label className="col-span-2 flex items-center gap-2 text-sm text-neutral-300">
            <input type="checkbox" checked={dbAll} onChange={(e) => setDbAll(e.target.checked)} />
            Toutes les bases
          </label>
          {!dbAll && (
            <label className="col-span-2 block">
              <span className="mb-1 block text-xs text-neutral-400">Bases (séparées par des virgules)</span>
              <input value={dbNames} onChange={(e) => setDbNames(e.target.value)} className={INPUT_CLASS} />
            </label>
          )}
        </div>
      )}

      {sourceType === "proxmox_vm" && (
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">VM / CT (la machine source doit être le nœud Proxmox concerné)</span>
          <select value={selectedVmid ?? ""} onChange={(e) => setSelectedVmid(Number(e.target.value))} className={INPUT_CLASS}>
            <option value="">— choisir —</option>
            {pveResources.map((r) => (
              <option key={r.vmid} value={r.vmid}>
                {r.vmid} · {r.name} ({r.type}, nœud {r.node})
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex justify-end">
        <button
          onClick={submit}
          disabled={creating}
          className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-900/60 disabled:opacity-50"
        >
          {creating ? "Création..." : "Créer le plan"}
        </button>
      </div>
    </div>
  );
}
