"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MaintenancePlansPanel from "@/components/MaintenancePlansPanel";

type Host = {
  id: number;
  name: string;
  kind: string;
  update_method: string | null;
};

type UpdateJob = {
  id: string;
  hostId: number;
  mode: "dry-run" | "apply";
  status: "running" | "success" | "failed";
  log: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
};

const METHOD_LABELS: Record<string, string> = {
  apt: "apt (Debian/Ubuntu)",
  opkg: "opkg (OpenWrt)",
  dsm: "DSM (Synology)",
};

const POLL_INTERVAL_MS = 1500;

export default function UpdatesPage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [jobs, setJobs] = useState<Record<number, UpdateJob | null>>({});
  const [allowAutoReboot, setAllowAutoReboot] = useState(true);
  const [runningAll, setRunningAll] = useState(false);
  const logRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const pollTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const scrollToBottom = useCallback((hostId: number) => {
    requestAnimationFrame(() => {
      const el = logRefs.current[hostId];
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  // Polls a job until it's no longer running, updating state as it goes — resolves once
  // finished so `runAll` can run hosts sequentially, same as before.
  const pollJob = useCallback(
    (hostId: number, jobId: string): Promise<void> => {
      return new Promise((resolve) => {
        const tick = async () => {
          try {
            const res = await fetch(`/api/updates/jobs/${jobId}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            const job: UpdateJob = data.job;
            setJobs((j) => ({ ...j, [hostId]: job }));
            scrollToBottom(hostId);
            if (job.status === "running") {
              pollTimers.current[hostId] = setTimeout(tick, POLL_INTERVAL_MS);
            } else {
              resolve();
            }
          } catch {
            resolve();
          }
        };
        tick();
      });
    },
    [scrollToBottom]
  );

  useEffect(() => {
    fetch("/api/hosts")
      .then((r) => r.json())
      .then(async (d) => {
        const withUpdates: Host[] = d.hosts.filter((h: Host) => h.update_method);
        setHosts(withUpdates);

        // Resume any job still running from before a navigation/refresh.
        for (const h of withUpdates) {
          const res = await fetch(`/api/updates/jobs/latest?hostId=${h.id}`);
          const data = await res.json();
          if (data.job) {
            setJobs((j) => ({ ...j, [h.id]: data.job }));
            scrollToBottom(h.id);
            if (data.job.status === "running") pollJob(h.id, data.job.id);
          }
        }
      });

    return () => {
      Object.values(pollTimers.current).forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runHost(hostId: number, mode: "dry-run" | "apply"): Promise<void> {
    try {
      const res = await fetch(`/api/updates/${hostId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, allowAutoReboot }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setJobs((j) => ({
        ...j,
        [hostId]: {
          id: data.jobId,
          hostId,
          mode,
          status: "running",
          log: "",
          exitCode: null,
          startedAt: new Date().toISOString(),
          finishedAt: null,
        },
      }));
      await pollJob(hostId, data.jobId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur inconnue";
      setJobs((j) => ({
        ...j,
        [hostId]: {
          id: "",
          hostId,
          mode,
          status: "failed",
          log: `Erreur: ${message}`,
          exitCode: null,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      }));
    }
  }

  async function runAll(mode: "dry-run" | "apply") {
    setRunningAll(true);
    for (const h of hosts) {
      await runHost(h.id, mode);
    }
    setRunningAll(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Mises à jour</h1>
          <p className="text-sm text-neutral-400">
            {hosts.length} machine{hosts.length > 1 ? "s" : ""} avec une méthode de mise à jour
            configurée. Les mises à jour tournent sur le serveur — tu peux naviguer ailleurs et
            revenir, la progression reprend automatiquement.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-neutral-400">
            <input
              type="checkbox"
              checked={allowAutoReboot}
              onChange={(e) => setAllowAutoReboot(e.target.checked)}
            />
            Redémarrer automatiquement si nécessaire (jamais sur le routeur)
          </label>
          <button
            onClick={() => runAll("dry-run")}
            disabled={runningAll}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800 disabled:opacity-50"
          >
            Preview (dry-run) — tout
          </button>
          <button
            onClick={() => runAll("apply")}
            disabled={runningAll}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            Tout mettre à jour
          </button>
        </div>
      </div>

      <MaintenancePlansPanel />

      <div className="space-y-3">
        {hosts.map((h) => {
          const job = jobs[h.id];
          const lines = job?.log ? job.log.split("\n").filter((l) => l.length > 0) : [];
          return (
            <div key={h.id} className="rounded border border-neutral-800">
              <div className="flex items-center justify-between px-4 py-2">
                <div>
                  <span className="font-medium text-sm">{h.name}</span>
                  <span className="ml-2 text-xs text-neutral-500">
                    {METHOD_LABELS[h.update_method ?? ""] ?? h.update_method}
                  </span>
                  {job?.status === "running" && (
                    <span className="ml-2 text-xs text-blue-400">
                      en cours ({job.mode === "dry-run" ? "preview" : "apply"})...
                    </span>
                  )}
                  {job?.status === "success" && (
                    <span className="ml-2 text-xs text-green-400">terminé</span>
                  )}
                  {job?.status === "failed" && (
                    <span className="ml-2 text-xs text-red-400">erreur</span>
                  )}
                </div>
                <div className="space-x-2">
                  <button
                    onClick={() => runHost(h.id, "dry-run")}
                    disabled={job?.status === "running"}
                    className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800 disabled:opacity-50"
                  >
                    Preview
                  </button>
                  <button
                    onClick={() => runHost(h.id, "apply")}
                    disabled={job?.status === "running"}
                    className="rounded bg-blue-600 px-2 py-1 text-xs font-medium hover:bg-blue-500 disabled:opacity-50"
                  >
                    Mettre à jour
                  </button>
                </div>
              </div>
              {lines.length > 0 && (
                <div
                  ref={(el) => {
                    logRefs.current[h.id] = el;
                  }}
                  className="max-h-64 overflow-auto border-t border-neutral-800 bg-black p-3 font-mono text-xs text-neutral-300"
                >
                  {lines.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
