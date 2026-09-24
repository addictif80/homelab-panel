"use client";

import { useEffect, useRef, useState } from "react";

export type JobView = {
  id: string;
  label: string;
  status: "running" | "success" | "failed";
  log: string;
  result: unknown;
  startedAt: string;
  finishedAt: string | null;
};

/**
 * Polls a background_jobs row (see lib/jobs.ts) until it finishes, streaming its live log —
 * generalized from the migration-specific version of this component so every new background
 * action (blocking, Docker stack redeploy, DB dump/restore...) gets the same live progress view
 * for free. Pass the job id you already have (just started it) or one recovered via
 * GET /api/jobs/latest on mount (the panel was reopened, or the action was started elsewhere).
 */
export default function JobLog({ jobId, onDone }: { jobId: string; onDone?: (job: JobView) => void }) {
  const [job, setJob] = useState<JobView | null>(null);
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
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [job?.log]);

  const failureMessage =
    job?.status === "failed" && job.result && typeof job.result === "object" && "error" in job.result
      ? String((job.result as { error?: unknown }).error ?? "")
      : "";

  return (
    <div className="space-y-2">
      <p className="text-sm">
        {job?.status === "running" && <span className="text-amber-400">{job.label} — en cours...</span>}
        {job?.status === "success" && <span className="text-emerald-400">{job.label} — terminé avec succès.</span>}
        {job?.status === "failed" && <span className="text-red-400">{job.label} — échec.</span>}
      </p>
      {failureMessage && (
        <p className="whitespace-pre-line rounded border border-red-900 bg-red-950/30 px-2 py-1.5 text-xs text-red-300">
          {failureMessage}
        </p>
      )}
      <pre
        ref={logRef}
        className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded border border-neutral-800 bg-neutral-950 p-2 text-[11px] text-neutral-400"
      >
        {job?.log || "Démarrage..."}
      </pre>
    </div>
  );
}
