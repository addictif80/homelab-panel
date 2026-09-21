"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Insight = { message: string; generatedAt: string } | null;

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(`${iso}Z`).getTime()) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.round(hours / 24)} j`;
}

/**
 * The assistant speaking first, not just answering — a short observation generated in the
 * background from the panel's own data (see lib/assistantInsights.ts), refreshed every ~12h, not
 * on every page load. Renders nothing if the AI isn't configured or hasn't generated anything yet,
 * rather than nagging every visitor to set it up.
 */
export default function ProactiveInsightBanner() {
  const [insight, setInsight] = useState<Insight>(null);
  const [configured, setConfigured] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  function load() {
    fetch("/api/assistant/proactive")
      .then((r) => r.json())
      .then((d) => {
        setInsight(d.insight);
        setConfigured(d.configured);
      })
      .catch(() => {});
  }

  useEffect(load, []);

  async function refresh() {
    setRefreshing(true);
    try {
      await fetch("/api/assistant/proactive", { method: "POST" });
      load();
    } finally {
      setRefreshing(false);
    }
  }

  if (!configured || !insight) return null;

  return (
    <div className="flex items-start gap-3 rounded border border-purple-900 bg-purple-950/20 p-3">
      <span className="mt-0.5 text-lg" aria-hidden>
        💬
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-purple-100">{insight.message}</p>
        <p className="mt-1 text-[11px] text-purple-400">
          Assistant IA · {timeAgo(insight.generatedAt)} ·{" "}
          <Link href="/assistant" className="underline hover:text-purple-300">
            en discuter
          </Link>{" "}
          ·{" "}
          <button onClick={refresh} disabled={refreshing} className="underline hover:text-purple-300 disabled:opacity-50">
            {refreshing ? "actualisation..." : "actualiser"}
          </button>
        </p>
      </div>
    </div>
  );
}
