"use client";

import { useEffect, useRef, useState } from "react";

type Job = { id: string; status: "running" | "success" | "failed"; log: string; result: { method?: string } | null };

/** Polls a migration job (Docker container or Proxmox VM/CT, both go through the same
 * migration_jobs table) until it finishes, streaming its log. */
export default function MigrationJobLog({ jobId, onDone }: { jobId: string; onDone?: () => void }) {
  const [job, setJob] = useState<Job | null>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const doneCalledRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      const res = await fetch(`/api/migration-jobs/${jobId}`);
      if (cancelled) return;
      const data = await res.json();
      if (data.job) {
        setJob(data.job);
        if (data.job.status === "running") {
          timer = setTimeout(poll, 1500);
        } else if (!doneCalledRef.current) {
          doneCalledRef.current = true;
          onDone?.();
        }
      }
    }
    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [job?.log]);

  return (
    <div className="space-y-2">
      <p className="text-sm">
        {job?.status === "running" && <span className="text-amber-400">Migration en cours...</span>}
        {job?.status === "success" && <span className="text-emerald-400">Migration terminée avec succès.</span>}
        {job?.status === "failed" && <span className="text-red-400">Échec de la migration.</span>}
      </p>
      {job?.result?.method === "dump-restore" && (
        <p className="text-xs text-amber-300">
          Effectuée par export/import (les nœuds ne sont pas dans le même cluster Proxmox) — la VM/CT source a été
          arrêtée le temps du vzdump.
        </p>
      )}
      <pre ref={logRef} className="max-h-64 overflow-y-auto rounded border border-neutral-800 bg-neutral-950 p-2 text-[11px] text-neutral-400">
        {job?.log || "Démarrage..."}
      </pre>
    </div>
  );
}
