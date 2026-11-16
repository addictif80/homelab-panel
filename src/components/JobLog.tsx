"use client";

import { useEffect, useRef, useState } from "react";
import ProgressBar from "./ProgressBar";

export type JobView = {
  id: string;
  label: string;
  status: "running" | "success" | "failed";
  log: string;
  result: unknown;
  progressCurrent?: number | null;
  progressTotal?: number | null;
  startedAt: string;
  finishedAt: string | null;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  const units = ["Ko", "Mo", "Go", "To"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

/**
 * Polls a background_jobs row (see lib/jobs.ts) until it finishes, showing the panel's one
 * progress-bar visual (determinate when the job reports a real total, indeterminate otherwise)
 * plus the live log underneath, collapsed by default. Pass the job id you already have (just
 * started it) or one recovered via GET /api/jobs/latest on mount (the panel was reopened, or the
 * action was started elsewhere).
 */
export default function JobLog({ jobId, onDone }: { jobId: string; onDone?: (job: JobView) => void }) {
  const [job, setJob] = useState<JobView | null>(null);
  const [showLog, setShowLog] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  const doneCalledRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    doneCalledRef.current = false;

    async function poll() {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (cancelled) return;
      const data = await res.json();
      if (data.job) {
        setJob(data.job);
        if (data.job.status === "running") {
          timer = setTimeout(poll, 1500);
        } else if (!doneCalledRef.current) {
          doneCalledRef.current = true;
          setShowLog((s) => s || data.job.status === "failed");
          onDone?.(data.job);
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
    if (showLog) logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [job?.log, showLog]);

  const failureMessage =
    job?.status === "failed" && job.result && typeof job.result === "object" && "error" in job.result
      ? String((job.result as { error?: unknown }).error ?? "")
      : "";

  const hasProgress = typeof job?.progressCurrent === "number" && typeof job?.progressTotal === "number";
  const percent = hasProgress ? Math.min(100, Math.max(0, Math.round((job!.progressCurrent! / job!.progressTotal!) * 100))) : null;

  if (!job) {
    return (
      <div className="space-y-1.5">
        <p className="text-sm text-neutral-400">Démarrage...</p>
        <ProgressBar status="running" />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-sm">
        {job.status === "running" && <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />}
        {job.status === "success" && <span className="text-emerald-400">✓</span>}
        {job.status === "failed" && <span className="text-red-400">✕</span>}
        <span
          className={
            job.status === "running" ? "text-neutral-200" : job.status === "success" ? "text-emerald-400" : "text-red-400"
          }
        >
          {job.label}
          {job.status === "running" ? " — en cours..." : job.status === "success" ? " — terminé." : " — échec."}
        </span>
        {percent !== null && job.status === "running" && (
          <span className="ml-auto font-mono text-xs text-neutral-400">{percent}%</span>
        )}
      </div>
      <ProgressBar status={job.status} current={job.progressCurrent} total={job.progressTotal} />
      {hasProgress && job.status === "running" && (
        <p className="text-xs text-neutral-500">
          {formatBytes(job.progressCurrent!)} / {formatBytes(job.progressTotal!)}
        </p>
      )}
      {failureMessage && (
        <p className="whitespace-pre-line rounded border border-red-900 bg-red-950/30 px-2 py-1.5 text-xs text-red-300">
          {failureMessage}
        </p>
      )}
      <button onClick={() => setShowLog((s) => !s)} className="text-xs text-neutral-500 hover:underline">
        {showLog ? "Masquer le journal" : "Voir le journal détaillé"}
      </button>
      {showLog && (
        <pre
          ref={logRef}
          className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded border border-neutral-800 bg-neutral-950 p-2 text-[11px] text-neutral-400"
        >
          {job.log || "..."}
        </pre>
      )}
    </div>
  );
}
