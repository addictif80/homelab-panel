"use client";

import { useCallback, useEffect, useState } from "react";
import JobLog from "@/components/JobLog";

type Job = {
  id: string;
  kind: string;
  label: string;
  hostId: number | null;
  status: "running" | "success" | "failed";
  log: string;
  startedAt: string;
  finishedAt: string | null;
};

const STATUS_STYLES: Record<Job["status"], string> = {
  running: "bg-blue-950/50 text-blue-300",
  success: "bg-emerald-950/50 text-emerald-300",
  failed: "bg-red-950/50 text-red-300",
};

const STATUS_LABELS: Record<Job["status"], string> = {
  running: "En cours",
  success: "Terminé",
  failed: "Échec",
};

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/jobs");
    const data = await res.json();
    setJobs(data.jobs ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Keeps the list itself (statuses, new entries) fresh even while nothing is expanded — the
  // expanded JobLog below does its own faster polling of the one job it's showing.
  useEffect(() => {
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-100">Activité en cours</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-400">
          Toutes les actions longues lancées depuis le panel (sauvegardes, blocages, redéploiements Docker,
          exports/imports de base de données...) — leur progression reste visible ici même si tu changes
          d&apos;appareil ou que tu refermes puis rouvres le panel.
        </p>
      </div>

      <div className="divide-y divide-neutral-800 rounded border border-neutral-800">
        {jobs.map((j) => (
          <div key={j.id}>
            <button
              onClick={() => setExpandedId(expandedId === j.id ? null : j.id)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-neutral-900"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-neutral-100">{j.label}</p>
                <p className="text-xs text-neutral-500">{new Date(`${j.startedAt}Z`).toLocaleString("fr-FR")}</p>
              </div>
              <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${STATUS_STYLES[j.status]}`}>{STATUS_LABELS[j.status]}</span>
            </button>
            {expandedId === j.id && (
              <div className="border-t border-neutral-800 bg-neutral-950/50 px-4 py-3">
                <JobLog jobId={j.id} onDone={load} />
              </div>
            )}
          </div>
        ))}
        {jobs.length === 0 && <p className="px-4 py-6 text-center text-sm text-neutral-600">Aucune activité pour l&apos;instant.</p>}
      </div>
    </div>
  );
}
