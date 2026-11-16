"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ProgressBar from "./ProgressBar";

type RunningJob = {
  id: string;
  label: string;
  progressCurrent: number | null;
  progressTotal: number | null;
};

const POLL_MS = 4000;

/**
 * Floating pill, visible from every page, so a long-running action (backup, migration, restore,
 * transfer...) started here or elsewhere — even from a tab that's since been closed — stays
 * visible instead of silently finishing (or failing) out of sight. Mirrors the per-action
 * progress bar in JobLog, just aggregated.
 */
export default function ActivityWidget() {
  const [jobs, setJobs] = useState<RunningJob[]>([]);

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

  if (jobs.length === 0) return null;

  const single = jobs.length === 1 ? jobs[0] : null;
  const label = single ? single.label : `${jobs.length} actions en cours`;

  return (
    <Link
      href="/jobs"
      className="fixed bottom-4 right-4 z-40 flex items-center gap-3 rounded-full border border-neutral-800 bg-neutral-900/95 px-4 py-2.5 text-sm shadow-lg shadow-black/30 backdrop-blur hover:border-neutral-700"
    >
      <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-blue-500" />
      <span className="max-w-[220px] truncate font-medium text-neutral-200">{label}</span>
      <span className="w-20">
        <ProgressBar status="running" current={single?.progressCurrent} total={single?.progressTotal} />
      </span>
    </Link>
  );
}
