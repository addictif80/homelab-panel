"use client";

import { useCallback, useEffect, useState } from "react";

type Point = { date: string; score: number };

function scoreColor(score: number): string {
  if (score >= 80) return "text-emerald-400";
  if (score >= 50) return "text-amber-400";
  return "text-red-400";
}

/** A tiny inline sparkline — 30 points is little enough that a full charting library would be
 * pure overhead for one line with no interaction. */
function Sparkline({ points }: { points: Point[] }) {
  if (points.length < 2) return null;
  const w = 240;
  const h = 40;
  const max = 100;
  const step = w / (points.length - 1);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - (p.score / max) * h).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-full text-blue-400">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function RiskScoreWidget() {
  const [history, setHistory] = useState<Point[] | null>(null);
  const [recomputing, setRecomputing] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/security/risk-score");
    const data = await res.json();
    setHistory(data.history ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function recompute() {
    setRecomputing(true);
    try {
      await fetch("/api/security/risk-score", { method: "POST" });
      await load();
    } finally {
      setRecomputing(false);
    }
  }

  const current = history?.at(-1)?.score;
  const previous = history && history.length > 1 ? history[history.length - 2].score : null;
  const trend = current !== undefined && previous !== null ? current! - previous : null;

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-100">Score de risque (30 jours)</h2>
        <button
          onClick={recompute}
          disabled={recomputing}
          className="text-xs text-blue-400 hover:underline disabled:opacity-50"
        >
          {recomputing ? "Calcul..." : "Recalculer"}
        </button>
      </div>

      {history === null ? (
        <p className="mt-3 text-xs text-neutral-500">Chargement...</p>
      ) : current === undefined ? (
        <p className="mt-3 text-xs text-neutral-500">
          Pas encore de score calculé — clique sur &quot;Recalculer&quot; pour lancer le premier calcul.
        </p>
      ) : (
        <div className="mt-3 flex items-center gap-4">
          <div className="shrink-0 text-center">
            <div className={`text-4xl font-bold ${scoreColor(current)}`}>{current}</div>
            <div className="text-[10px] uppercase tracking-wide text-neutral-600">/ 100</div>
            {trend !== null && trend !== 0 && (
              <div className={`mt-1 text-xs ${trend > 0 ? "text-emerald-400" : "text-red-400"}`}>
                {trend > 0 ? "▲" : "▼"} {Math.abs(trend)} vs hier
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <Sparkline points={history} />
            <p className="mt-1 text-[10px] text-neutral-600">
              {history[0]?.date} → {history.at(-1)?.date}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
