"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DirectoryPicker from "@/components/DirectoryPicker";

type Host = { id: number; name: string; kind: string; docker_enabled: number; proxmox_node: string | null };
type SourceType = "paths" | "docker" | "database" | "proxmox_vm" | "panel_config";
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
  panel_config: "Configuration du panel",
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
  const [importingRunId, setImportingRunId] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState("");
  const [resurrecting, setResurrecting] = useState<BackupPlan | null>(null);
  const [showClone, setShowClone] = useState(false);
  const [resurrectionJobId, setResurrectionJobId] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  async function importPanelConfig(runId: string) {
    if (!confirm("Ça va remplacer l'inventaire, les identifiants et les intégrations actuels par ceux de cette sauvegarde. Continuer ?")) {
      return;
    }
    setImportingRunId(runId);
    setImportMsg("");
    try {
      const res = await fetch(`/api/backups/runs/${runId}/import-panel-config`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setImportMsg(`Restauré : ${data.summary.filter((s: { rows: number }) => s.rows > 0).map((s: { table: string; rows: number }) => `${s.table} (${s.rows})`).join(", ") || "rien"}.`);
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setImportingRunId(null);
    }
  }

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
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => setShowClone(true)}
            className="rounded border border-emerald-700 bg-emerald-900/30 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-900/50"
          >
            Cloner vers une machine neuve
          </button>
          <button
            onClick={() => setShowCreate((s) => !s)}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
          >
            {showCreate ? "Annuler" : "+ Nouveau plan"}
          </button>
        </div>
      </div>

      {error && <div className="rounded border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{error}</div>}

      <Rule321Panel />

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
                  {plan.latestRun?.status === "success" && (
                    <button
                      onClick={() => setResurrecting(plan)}
                      className="rounded border border-emerald-700 bg-emerald-900/30 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-900/50"
                    >
                      Renaissance ailleurs
                    </button>
                  )}
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
                                {plan.sourceType === "panel_config" ? (
                                  <button
                                    onClick={() => importPanelConfig(run.id)}
                                    disabled={importingRunId === run.id}
                                    className="rounded border border-amber-800 bg-amber-950/30 px-1.5 py-0.5 text-amber-300 hover:bg-amber-950/60 disabled:opacity-50"
                                  >
                                    {importingRunId === run.id ? "Import..." : "Importer dans le panel"}
                                  </button>
                                ) : (
                                  run.paths.map((p) => (
                                    <button
                                      key={p}
                                      onClick={() => setRestoring({ plan, run, path: p })}
                                      className="rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-300 hover:bg-neutral-800"
                                    >
                                      Restaurer {p}
                                    </button>
                                  ))
                                )}
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
      {importMsg && <p className="text-sm text-neutral-400">{importMsg}</p>}

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

      {resurrecting && (
        <ResurrectModal
          hosts={hosts}
          plan={resurrecting}
          onClose={() => setResurrecting(null)}
          onStarted={(jobId) => {
            setResurrecting(null);
            setResurrectionJobId(jobId);
          }}
        />
      )}

      {showClone && (
        <CloneModal
          hosts={hosts}
          plans={plans ?? []}
          onClose={() => setShowClone(false)}
          onStarted={(jobId) => {
            setShowClone(false);
            setResurrectionJobId(jobId);
          }}
        />
      )}

      {resurrectionJobId && (
        <ResurrectionJobPanel jobId={resurrectionJobId} onClose={() => setResurrectionJobId(null)} />
      )}
    </div>
  );
}

type Rule321Status = {
  hostId: number;
  hostName: string;
  totalCopies: number;
  distinctDestinations: number;
  hasOffsiteDestination: boolean;
  offsiteStale: boolean;
  offsiteLastSuccessAt: string | null;
  compliant: boolean;
  reasons: string[];
};

/** Real verification of the 3-2-1 rule (3 copies, 2 media, 1 offsite) per source host — not just
 * "the last run succeeded", but whether the strategy around it actually survives losing that
 * host entirely. See lib/backup/rule321.ts for how each condition is derived. */
function Rule321Panel() {
  const [statuses, setStatuses] = useState<Rule321Status[] | null>(null);

  useEffect(() => {
    fetch("/api/backups/rule321")
      .then((r) => r.json())
      .then((d) => setStatuses(d.statuses ?? []))
      .catch(() => setStatuses([]));
  }, []);

  if (statuses === null) return null;
  if (statuses.length === 0) return null;

  const nonCompliant = statuses.filter((s) => !s.compliant);

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-100">Règle 3-2-1</h2>
        <span className={`text-xs ${nonCompliant.length === 0 ? "text-emerald-400" : "text-amber-400"}`}>
          {nonCompliant.length === 0
            ? "Toutes les machines sauvegardées respectent la règle"
            : `${nonCompliant.length}/${statuses.length} machine(s) à risque`}
        </span>
      </div>
      <p className="mb-3 text-xs text-neutral-500">
        3 copies de chaque donnée, sur 2 supports différents, dont 1 hors-site — vérifié pour de vrai à partir de
        tes plans de sauvegarde, pas juste « le dernier run a réussi ».
      </p>
      <div className="space-y-2">
        {statuses.map((s) => (
          <div key={s.hostId} className={`rounded border px-3 py-2 text-xs ${s.compliant ? "border-neutral-800" : "border-amber-900 bg-amber-950/20"}`}>
            <div className="flex items-center justify-between">
              <span className="font-medium text-neutral-200">{s.hostName}</span>
              <span className={s.compliant ? "text-emerald-400" : "text-amber-400"}>
                {s.compliant ? "Conforme" : "Non conforme"}
              </span>
            </div>
            {!s.compliant && (
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-neutral-400">
                {s.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
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
  const [browsing, setBrowsing] = useState<"source" | "dest" | null>(null);

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
  const [containersError, setContainersError] = useState("");

  useEffect(() => {
    if (!sourceHostId) return;
    if (sourceType === "docker" || sourceType === "database") {
      setContainersError("");
      fetch(`/api/docker/${sourceHostId}/containers`)
        .then((r) => r.json())
        .then((d) => {
          // A failed listing (permission denied, sudo not configured for this host, docker not
          // found...) used to silently look identical to "this machine really has zero
          // containers" — surface the real reason instead of defaulting to an empty list.
          if (d.error) {
            setContainersError(d.error);
            setContainers([]);
            return;
          }
          setContainers(d.containers || []);
        })
        .catch(() => setContainersError("Impossible de contacter le panel."));
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
          <div className="flex gap-2">
            <input value={destPath} onChange={(e) => setDestPath(e.target.value)} className={INPUT_CLASS} />
            <button
              type="button"
              onClick={() => setBrowsing("dest")}
              disabled={!destHostId}
              className="shrink-0 rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
            >
              Parcourir...
            </button>
          </div>
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
          <button
            type="button"
            onClick={() => setBrowsing("source")}
            disabled={!sourceHostId}
            className="mt-1.5 rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
          >
            Parcourir la machine source...
          </button>
        </label>
      )}

      {browsing && (
        <DirectoryPicker
          hostId={(browsing === "source" ? sourceHostId : destHostId)!}
          initialPath={browsing === "source" ? pathsText.split("\n").pop()?.trim() || "/" : destPath}
          onClose={() => setBrowsing(null)}
          onSelect={(path) => {
            if (browsing === "source") {
              setPathsText((prev) => {
                const lines = prev.split("\n").map((l) => l.trim()).filter(Boolean);
                return lines.includes(path) ? prev : [...lines, path].join("\n");
              });
            } else {
              setDestPath(path);
            }
            setBrowsing(null);
          }}
        />
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
            {containers.length === 0 && !containersError && (
              <p className="p-2 text-xs text-neutral-600">Aucun conteneur sur cette machine.</p>
            )}
          </div>
          {containersError && (
            <p className="mt-1 text-xs text-red-400">
              Impossible de lister les conteneurs : {containersError}
            </p>
          )}
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

type ResurrectionJob = {
  id: string;
  kind: "single" | "clone";
  status: "running" | "success" | "failed";
  log: string;
  startedAt: string;
  finishedAt: string | null;
};

/**
 * Picks the machine that gets the service back — the plan's own destination host holds the
 * snapshot, so it's excluded (that's the source of the data, never a sensible resurrection
 * target). Used by both "Renaissance ailleurs" (one plan) and "Cloner vers une machine neuve"
 * (every plan of a host, looped — see lib/backup/resurrect.ts).
 */
function ResurrectModal({
  hosts,
  plan,
  onClose,
  onStarted,
}: {
  hosts: Host[];
  plan: BackupPlan;
  onClose: () => void;
  onStarted: (jobId: string) => void;
}) {
  const candidates = hosts.filter((h) => h.id !== plan.destHostId);
  const [targetHostId, setTargetHostId] = useState(candidates[0]?.id ?? plan.sourceHostId);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setStarting(true);
    setError("");
    try {
      const res = await fetch(`/api/backups/${plan.id}/resurrect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetHostId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onStarted(data.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md space-y-3 rounded border border-neutral-700 bg-neutral-950 p-4">
        <h2 className="text-sm font-semibold text-neutral-100">Renaissance ailleurs</h2>
        <p className="text-xs text-neutral-500">
          Restaure la dernière sauvegarde réussie de &laquo; {plan.name} &raquo; sur une autre machine — et, si
          c&apos;est une sauvegarde Docker, relance directement le(s) conteneur(s) dessus.
        </p>
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">Machine cible</span>
          <select value={targetHostId} onChange={(e) => setTargetHostId(Number(e.target.value))} className={INPUT_CLASS}>
            {candidates.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} disabled={starting} className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800">
            Annuler
          </button>
          <button
            onClick={start}
            disabled={starting || !targetHostId}
            className="rounded border border-emerald-700 bg-emerald-900/40 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-900/60 disabled:opacity-50"
          >
            {starting ? "Démarrage..." : "Lancer la renaissance"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * "Clone tout ton setup" — every backup plan of one machine, replayed onto a fresh one in a
 * single job. Honest framing: this replays what's actually been backed up (dossiers, volumes
 * Docker, dumps...), not an image of the OS itself — see lib/backup/resurrect.ts.
 */
function CloneModal({
  hosts,
  plans,
  onClose,
  onStarted,
}: {
  hosts: Host[];
  plans: BackupPlan[];
  onClose: () => void;
  onStarted: (jobId: string) => void;
}) {
  const sourceHostIds = Array.from(new Set(plans.map((p) => p.sourceHostId)));
  const sourceHosts = hosts.filter((h) => sourceHostIds.includes(h.id));
  const [sourceHostId, setSourceHostId] = useState<number | null>(sourceHosts[0]?.id ?? null);
  const [targetHostId, setTargetHostId] = useState<number | null>(hosts.find((h) => h.id !== sourceHosts[0]?.id)?.id ?? null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const planCount = plans.filter((p) => p.sourceHostId === sourceHostId).length;

  async function start() {
    if (!sourceHostId || !targetHostId) return;
    setStarting(true);
    setError("");
    try {
      const res = await fetch(`/api/hosts/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceHostId, targetHostId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onStarted(data.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md space-y-3 rounded border border-neutral-700 bg-neutral-950 p-4">
        <h2 className="text-sm font-semibold text-neutral-100">Cloner vers une machine neuve</h2>
        <p className="text-xs text-neutral-500">
          Rejoue toutes les dernières sauvegardes réussies d&apos;une machine sur une machine neuve déjà présente
          dans l&apos;inventaire — dossiers, volumes Docker (avec relance des conteneurs), dumps de bases de
          données. Pas un clonage d&apos;OS : seulement ce que tes plans de sauvegarde couvrent déjà.
        </p>
        {sourceHosts.length === 0 ? (
          <p className="rounded border border-amber-900 bg-amber-950/30 p-2 text-xs text-amber-300">
            Aucun plan de sauvegarde n&apos;existe pour l&apos;instant — crées-en au moins un avant de pouvoir cloner
            une machine.
          </p>
        ) : (
          <>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-400">Machine à cloner</span>
              <select
                value={sourceHostId ?? ""}
                onChange={(e) => setSourceHostId(Number(e.target.value))}
                className={INPUT_CLASS}
              >
                {sourceHosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-neutral-500">{planCount} plan(s) de sauvegarde seront rejoués.</span>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-400">Machine neuve (destination)</span>
              <select
                value={targetHostId ?? ""}
                onChange={(e) => setTargetHostId(Number(e.target.value))}
                className={INPUT_CLASS}
              >
                {hosts
                  .filter((h) => h.id !== sourceHostId)
                  .map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
              </select>
            </label>
          </>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} disabled={starting} className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800">
            Annuler
          </button>
          <button
            onClick={start}
            disabled={starting || !sourceHostId || !targetHostId || sourceHosts.length === 0}
            className="rounded border border-emerald-700 bg-emerald-900/40 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-900/60 disabled:opacity-50"
          >
            {starting ? "Démarrage..." : "Lancer le clonage"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Live log for a renaissance/clonage job, polled while running — same spirit as the backup run
 * panel above, just against /api/backups/resurrections instead of a backup run. */
function ResurrectionJobPanel({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const [job, setJob] = useState<ResurrectionJob | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const res = await fetch(`/api/backups/resurrections/${jobId}`);
      if (cancelled) return;
      const data = await res.json();
      setJob(data);
      if (data.status === "running") setTimeout(poll, 1500);
    }
    poll();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [job?.log]);

  const title =
    job?.status === "running"
      ? job.kind === "clone"
        ? "Clonage en cours..."
        : "Renaissance en cours..."
      : job?.status === "success"
        ? "Terminé"
        : "Échec";

  return (
    <div className="fixed bottom-4 right-4 z-40 w-full max-w-lg rounded border border-neutral-700 bg-neutral-950 shadow-xl">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <span className="text-sm text-neutral-200">{title}</span>
        <button onClick={onClose} className="text-xs text-neutral-500 hover:text-neutral-300">
          Fermer
        </button>
      </div>
      <pre ref={logRef} className="max-h-64 overflow-auto whitespace-pre-wrap bg-black p-2 font-mono text-[11px] text-neutral-300">
        {job?.log || "Démarrage..."}
      </pre>
    </div>
  );
}
