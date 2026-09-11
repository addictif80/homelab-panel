"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";

const LiveLogPanel = dynamic(() => import("@/components/LiveLogPanel"), { ssr: false });

type LogSource = {
  id: string;
  hostName: string;
  label: string;
  category: "web-access" | "web-error" | "mail";
};

/** Tabbed live-log viewer for the Security Center — one tab per configured source instead of
 * stacking every source's tail vertically, so the logs column stays a fixed height regardless of
 * how many sources are configured. Sources themselves are still managed from the dashboard. */
export default function SecurityLogsPanel() {
  const [sources, setSources] = useState<LogSource[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/logs/sources")
      .then((res) => res.json())
      .then((data) => {
        setSources(data.sources);
        if (data.sources?.length > 0) setActiveId(data.sources[0].id);
      })
      .catch(() => setSources([]));
  }, []);

  return (
    <div className="flex h-full flex-col rounded border border-neutral-800 bg-neutral-900">
      <div className="border-b border-neutral-800 px-4 py-3">
        <h2 className="text-sm font-semibold text-neutral-100">Logs</h2>
        <p className="mt-0.5 text-xs text-neutral-500">Suivi en direct des accès web et mail, avec détection d&apos;IP suspectes.</p>
      </div>

      {sources && sources.length === 0 && (
        <p className="p-4 text-sm text-neutral-500">
          Aucune source de logs configurée.{" "}
          <Link href="/" className="text-blue-400 hover:underline">
            Ajoute-en une depuis la vue d&apos;ensemble
          </Link>
          .
        </p>
      )}

      {sources && sources.length > 0 && (
        <>
          <div className="flex flex-wrap gap-1 border-b border-neutral-800 px-2 pt-2">
            {sources.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveId(s.id)}
                className={`rounded-t px-3 py-1.5 text-xs ${
                  activeId === s.id
                    ? "border border-b-0 border-neutral-700 bg-neutral-950 text-neutral-100"
                    : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {s.label} <span className="text-neutral-600">· {s.hostName}</span>
              </button>
            ))}
          </div>
          <div className="p-3">{activeId && <LiveLogPanel key={activeId} sourceId={activeId} />}</div>
        </>
      )}
    </div>
  );
}
