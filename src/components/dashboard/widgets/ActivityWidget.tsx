"use client";

import { useEffect, useState } from "react";
import ProgressBar from "../../ProgressBar";
import { WidgetLoading } from "../shared";

type RunningJob = {
  id: string;
  label: string;
  progressCurrent: number | null;
  progressTotal: number | null;
};

const POLL_MS = 4000;

/** Dashboard-sized version of the floating ActivityWidget — same /api/jobs?running=1 polling,
 * laid out as a list rather than a single aggregated pill, so a user who added this widget sees
 * every running action (backup, migration, restore...) with its own progress bar at a glance. */
export function ActivityJobsWidget() {
  const [jobs, setJobs] = useState<RunningJob[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch("/api/jobs?running=1");
        const data = await res.json();
        if (!cancelled) setJobs(data.jobs ?? []);
      } catch {
        // best-effort — a missed tick just tries again next cycle
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    }
    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  if (jobs === null) return <WidgetLoading />;
  if (jobs.length === 0) return <p className="text-xs text-neutral-500">Aucune action en cours.</p>;

  return (
    <div className="space-y-3">
      {jobs.map((job) => (
        <div key={job.id} className="space-y-1">
          <p className="truncate text-xs font-medium text-neutral-300">{job.label}</p>
          <ProgressBar status="running" current={job.progressCurrent} total={job.progressTotal} />
        </div>
      ))}
      <a href="/jobs" className="inline-block text-xs text-blue-600 hover:underline">
        Journal complet →
      </a>
    </div>
  );
}
