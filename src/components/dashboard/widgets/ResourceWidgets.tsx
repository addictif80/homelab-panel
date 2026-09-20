"use client";

import { useEffect, useState } from "react";
import { AVATAR_GRADIENTS, StatCard, WidgetLoading, formatGb, initialsOf } from "../shared";

type HostStats = {
  hostId: number;
  hostName: string;
  cores: number | null;
  cpuUsedPercent: number | null;
  memTotalMb: number | null;
  memUsedMb: number | null;
  diskTotalGb: number | null;
  diskUsedGb: number | null;
  error: string | null;
};

function useHostStats() {
  const [stats, setStats] = useState<HostStats[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/monitoring/stats")
      .then((r) => r.json())
      .then((d) => setStats(d.hosts ?? []))
      .finally(() => setLoading(false));
  }, []);
  return { stats, loading };
}

export function ResourcesWidget() {
  const { stats, loading } = useHostStats();
  if (loading) return <WidgetLoading />;

  const reachable = stats.filter((s) => s.error === null);
  const totals = reachable.reduce(
    (acc, s) => ({
      cores: acc.cores + (s.cores ?? 0),
      memTotal: acc.memTotal + (s.memTotalMb ?? 0) / 1024,
      memUsed: acc.memUsed + (s.memUsedMb ?? 0) / 1024,
      diskTotal: acc.diskTotal + (s.diskTotalGb ?? 0),
      diskUsed: acc.diskUsed + (s.diskUsedGb ?? 0),
      cpuSum: acc.cpuSum + (s.cpuUsedPercent ?? 0),
    }),
    { cores: 0, memTotal: 0, memUsed: 0, diskTotal: 0, diskUsed: 0, cpuSum: 0 }
  );
  const avgCpu = reachable.length > 0 ? totals.cpuSum / reachable.length : null;

  return (
    <div className="grid grid-cols-2 gap-3 @sm:grid-cols-4">
      <StatCard
        label="CPU (moyenne)"
        value={avgCpu === null ? "—" : `${avgCpu.toFixed(0)}%`}
        sub={`${totals.cores} cœurs cumulés`}
        color="accent"
        icon={
          <>
            <rect x="6" y="6" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
            <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </>
        }
      />
      <StatCard
        label="RAM utilisée"
        value={formatGb(totals.memUsed)}
        sub={`sur ${formatGb(totals.memTotal)}`}
        color="success"
        icon={
          <>
            <rect x="3" y="7" width="18" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
            <path d="M7 7v10M11 7v10M15 7v10" stroke="currentColor" strokeWidth="1.6" />
          </>
        }
      />
      <StatCard
        label="Stockage utilisé"
        value={formatGb(totals.diskUsed)}
        sub={`sur ${formatGb(totals.diskTotal)}`}
        color="warning"
        icon={
          <>
            <path d="M12 3l9 16H3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M12 9v4M12 16.5h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </>
        }
      />
      <StatCard
        label="Machines"
        value={`${reachable.length}/${stats.length}`}
        sub="joignables"
        color="accent2"
        icon={
          <>
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
            <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </>
        }
      />
    </div>
  );
}

export function MachinesWidget() {
  const { stats, loading } = useHostStats();
  if (loading) return <WidgetLoading />;
  const reachable = stats.filter((s) => s.error === null);
  if (reachable.length === 0) return <p className="text-xs text-neutral-500">Aucune machine joignable.</p>;

  return (
    <div className="overflow-auto rounded-lg border border-neutral-800">
      <table className="w-full text-sm">
        <thead className="bg-neutral-950 text-left text-[11px] uppercase tracking-wider text-neutral-600">
          <tr>
            <th className="px-3 py-2.5 font-semibold">Machine</th>
            <th className="px-3 py-2.5 font-semibold">CPU</th>
            <th className="px-3 py-2.5 font-semibold">RAM</th>
            <th className="px-3 py-2.5 font-semibold">Disque</th>
          </tr>
        </thead>
        <tbody>
          {reachable.map((s, i) => (
            <tr key={s.hostId} className="border-t border-neutral-800">
              <td className="px-3 py-2.5 font-medium">
                <div className="flex items-center gap-2.5">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] text-[11px] font-bold text-white"
                    style={{ backgroundImage: AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length] }}
                  >
                    {initialsOf(s.hostName)}
                  </span>
                  {s.hostName}
                </div>
              </td>
              <td className="px-3 py-2.5 text-neutral-400">{s.cpuUsedPercent === null ? "—" : `${s.cpuUsedPercent.toFixed(0)}%`}</td>
              <td className="px-3 py-2.5 text-neutral-400">
                {formatGb((s.memUsedMb ?? 0) / 1024)} / {formatGb((s.memTotalMb ?? 0) / 1024)}
              </td>
              <td className="px-3 py-2.5 text-neutral-400">
                {formatGb(s.diskUsedGb)} / {formatGb(s.diskTotalGb)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AlertsWidget() {
  const { stats, loading } = useHostStats();
  if (loading) return <WidgetLoading />;
  const errored = stats.filter((s) => s.error);
  if (errored.length === 0) return <p className="text-xs text-neutral-500">Aucune alerte — toutes les machines répondent.</p>;

  return (
    <div className="divide-y divide-neutral-800 -mx-4 -mb-4 mt-1">
      {errored.map((s) => (
        <div key={s.hostId} className="flex items-start gap-2.5 px-4 py-3 text-xs">
          <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
          <span className="text-neutral-300">
            <span className="font-medium">{s.hostName}</span> : {s.error}
          </span>
        </div>
      ))}
    </div>
  );
}
