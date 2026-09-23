"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type FleetHost = { hostId: number; hostName: string; reachable: boolean; latencyMs: number | null };
type Activity = { action: string; target: string | null; createdAt: string };
type Data = {
  fleet: FleetHost[];
  downHosts: FleetHost[];
  riskScore: number | null;
  incidentCount: number;
  stalePlanCount: number;
  totalActivePlans: number;
  recentActivity: Activity[];
  generatedAt: string;
};

const REFRESH_MS = 10_000;

function riskColor(score: number | null): string {
  if (score === null) return "text-neutral-500";
  if (score >= 80) return "text-emerald-400";
  if (score >= 50) return "text-amber-400";
  return "text-red-400";
}

export default function MissionControlPage() {
  const [data, setData] = useState<Data | null>(null);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch("/api/mission-control");
      if (!cancelled && res.ok) setData(await res.json());
    }
    load();
    const dataTimer = setInterval(load, REFRESH_MS);
    const clockTimer = setInterval(() => setNow(new Date()), 1000);
    return () => {
      cancelled = true;
      clearInterval(dataTimer);
      clearInterval(clockTimer);
    };
  }, []);

  const upCount = data ? data.fleet.length - data.downHosts.length : 0;
  const allUp = data && data.downHosts.length === 0;

  return (
    <div className="min-h-screen bg-black p-6 text-neutral-100">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Mission Control</h1>
          <p className="text-xs text-neutral-500">Rafraîchi toutes les {REFRESH_MS / 1000}s — sans interaction</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-2xl tabular-nums text-neutral-300">
            {now.toLocaleTimeString("fr-FR")}
          </span>
          <Link href="/" className="text-xs text-neutral-600 hover:text-neutral-400">
            ← Retour au panel
          </Link>
        </div>
      </div>

      {!data ? (
        <p className="text-neutral-500">Chargement...</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className={`rounded-xl border p-5 ${allUp ? "border-emerald-900 bg-emerald-950/20" : "border-red-900 bg-red-950/20"}`}>
            <p className="text-xs uppercase tracking-wide text-neutral-500">Flotte</p>
            <p className={`mt-2 text-5xl font-bold ${allUp ? "text-emerald-400" : "text-red-400"}`}>
              {upCount}/{data.fleet.length}
            </p>
            <p className="mt-1 text-sm text-neutral-400">{allUp ? "Tout est en ligne" : "machines en ligne"}</p>
            {data.downHosts.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-red-900/50 pt-2">
                {data.downHosts.map((h) => (
                  <li key={h.hostId} className="text-sm text-red-300">
                    ● {h.hostName}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Score de risque</p>
            <p className={`mt-2 text-5xl font-bold ${riskColor(data.riskScore)}`}>
              {data.riskScore ?? "—"}
            </p>
            <p className="mt-1 text-sm text-neutral-400">/ 100 sur les 7 derniers jours</p>
          </div>

          <div className={`rounded-xl border p-5 ${data.incidentCount > 0 ? "border-amber-900 bg-amber-950/20" : "border-neutral-800 bg-neutral-950"}`}>
            <p className="text-xs uppercase tracking-wide text-neutral-500">Incidents (24h)</p>
            <p className={`mt-2 text-5xl font-bold ${data.incidentCount > 0 ? "text-amber-400" : "text-neutral-100"}`}>
              {data.incidentCount}
            </p>
            <p className="mt-1 text-sm text-neutral-400">
              <Link href="/incidents" className="hover:underline">
                Voir le détail →
              </Link>
            </p>
          </div>

          <div className={`rounded-xl border p-5 ${data.stalePlanCount > 0 ? "border-amber-900 bg-amber-950/20" : "border-neutral-800 bg-neutral-950"}`}>
            <p className="text-xs uppercase tracking-wide text-neutral-500">Sauvegardes en retard</p>
            <p className={`mt-2 text-5xl font-bold ${data.stalePlanCount > 0 ? "text-amber-400" : "text-neutral-100"}`}>
              {data.stalePlanCount}
            </p>
            <p className="mt-1 text-sm text-neutral-400">sur {data.totalActivePlans} plan{data.totalActivePlans !== 1 ? "s" : ""} actif{data.totalActivePlans !== 1 ? "s" : ""}</p>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5 md:col-span-2 xl:col-span-4">
            <p className="mb-3 text-xs uppercase tracking-wide text-neutral-500">Activité récente</p>
            <div className="space-y-1.5">
              {data.recentActivity.map((a, idx) => (
                <div key={idx} className="flex items-center justify-between font-mono text-xs text-neutral-400">
                  <span>
                    {a.action}
                    {a.target && <span className="text-neutral-600"> · {a.target}</span>}
                  </span>
                  <span className="text-neutral-600">{new Date(`${a.createdAt}Z`).toLocaleTimeString("fr-FR")}</span>
                </div>
              ))}
              {data.recentActivity.length === 0 && <p className="text-sm text-neutral-600">Aucune activité récente.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
