"use client";

import { useEffect, useState } from "react";
import { MiniStat, WidgetLoading } from "../shared";

type BackupPlan = { id: string; name: string; enabled: boolean };
type BackupRun = { status: "running" | "success" | "failed"; finishedAt: string | null } | null;
type Rule321Status = { hostId: number; hostName: string; compliant: boolean; reasons: string[] };

export function BackupsWidget() {
  const [plans, setPlans] = useState<{ plan: BackupPlan; latestRun: BackupRun }[] | null>(null);

  useEffect(() => {
    fetch("/api/backups")
      .then((r) => r.json())
      .then((d) => setPlans(d.plans ?? []))
      .catch(() => setPlans([]));
  }, []);

  if (plans === null) return <WidgetLoading />;
  if (plans.length === 0) return <p className="text-xs text-neutral-500">Aucun plan de sauvegarde configuré.</p>;

  const failed = plans.filter((p) => p.latestRun?.status === "failed").length;

  return (
    <div className="space-y-2">
      <MiniStat
        value={String(plans.length)}
        label={failed > 0 ? `dont ${failed} en échec au dernier run` : "plan(s), tous OK au dernier run"}
        tone={failed > 0 ? "danger" : "success"}
      />
      <ul className="space-y-1 text-xs text-neutral-400">
        {plans.slice(0, 4).map(({ plan, latestRun }) => (
          <li key={plan.id} className="flex items-center justify-between gap-2">
            <span className="truncate">{plan.name}</span>
            <span
              className={
                latestRun?.status === "failed"
                  ? "text-red-400"
                  : latestRun?.status === "success"
                    ? "text-emerald-400"
                    : "text-neutral-500"
              }
            >
              {latestRun?.status ?? "jamais lancé"}
            </span>
          </li>
        ))}
      </ul>
      <a href="/backups" className="inline-block text-xs text-blue-600 hover:underline">
        Voir plus →
      </a>
    </div>
  );
}

export function BackupRule321Widget() {
  const [statuses, setStatuses] = useState<Rule321Status[] | null>(null);

  useEffect(() => {
    fetch("/api/backups/rule321")
      .then((r) => r.json())
      .then((d) => setStatuses(d.statuses ?? []))
      .catch(() => setStatuses([]));
  }, []);

  if (statuses === null) return <WidgetLoading />;
  if (statuses.length === 0) return <p className="text-xs text-neutral-500">Aucun plan de sauvegarde configuré.</p>;

  const nonCompliant = statuses.filter((s) => !s.compliant);

  return (
    <div className="space-y-2">
      <MiniStat
        value={`${statuses.length - nonCompliant.length}/${statuses.length}`}
        label="machine(s) conformes à la règle 3-2-1"
        tone={nonCompliant.length === 0 ? "success" : "warning"}
      />
      {nonCompliant.length > 0 && (
        <ul className="space-y-1 text-xs text-neutral-400">
          {nonCompliant.slice(0, 3).map((s) => (
            <li key={s.hostId} className="truncate">
              <span className="text-amber-400">{s.hostName}</span> — {s.reasons[0]}
            </li>
          ))}
        </ul>
      )}
      <a href="/backups" className="inline-block text-xs text-blue-600 hover:underline">
        Voir le détail →
      </a>
    </div>
  );
}

type CertStatus = { id: string; domain: string; daysRemaining: number | null; error: string | null };

export function CertificatesWidget() {
  const [statuses, setStatuses] = useState<CertStatus[] | null>(null);

  useEffect(() => {
    fetch("/api/settings/certificates/status")
      .then((r) => r.json())
      .then((d) => setStatuses(d.statuses ?? []))
      .catch(() => setStatuses([]));
  }, []);

  if (statuses === null) return <WidgetLoading />;
  if (statuses.length === 0) return <p className="text-xs text-neutral-500">Aucun domaine surveillé.</p>;

  const soon = statuses.filter((s) => s.daysRemaining !== null && s.daysRemaining <= 21);

  return (
    <div className="space-y-2">
      <MiniStat
        value={String(soon.length)}
        label={soon.length > 0 ? "certificat(s) à renouveler bientôt" : "certificat(s), aucun à renouveler bientôt"}
        tone={soon.length > 0 ? "warning" : "success"}
      />
      <ul className="space-y-1 text-xs text-neutral-400">
        {statuses.slice(0, 4).map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2">
            <span className="truncate">{s.domain}</span>
            <span className={s.daysRemaining !== null && s.daysRemaining <= 21 ? "text-amber-400" : ""}>
              {s.error ? "erreur" : s.daysRemaining !== null ? `${s.daysRemaining} j` : "—"}
            </span>
          </li>
        ))}
      </ul>
      <a href="/settings" className="inline-block text-xs text-blue-600 hover:underline">
        Voir plus →
      </a>
    </div>
  );
}

export function UptimeWidget() {
  const [url, setUrl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    fetch("/api/settings/uptime-kuma")
      .then((r) => r.json())
      .then((d) => setUrl(d.url || null))
      .catch(() => setUrl(null));
  }, []);

  if (url === undefined) return <WidgetLoading />;
  if (!url) {
    return (
      <p className="text-xs text-neutral-500">
        Uptime Kuma n&apos;est pas encore configuré.{" "}
        <a href="/uptime" className="text-blue-600 hover:underline">
          Configurer →
        </a>
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <iframe src={url} className="h-64 w-full rounded-lg border border-neutral-800" />
      <a href="/uptime" className="inline-block text-xs text-blue-600 hover:underline">
        Voir en grand →
      </a>
    </div>
  );
}

export function MaintenanceWidget() {
  const [plans, setPlans] = useState<unknown[] | null>(null);

  useEffect(() => {
    fetch("/api/maintenance/plans")
      .then((r) => r.json())
      .then((d) => setPlans(d.plans ?? []))
      .catch(() => setPlans([]));
  }, []);

  if (plans === null) return <WidgetLoading />;

  return <MiniStat value={String(plans.length)} label="fenêtre(s) de maintenance configurée(s)" href="/updates" />;
}
