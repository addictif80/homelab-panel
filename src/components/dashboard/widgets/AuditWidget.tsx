"use client";

import { useEffect, useState } from "react";
import { WidgetLoading } from "../shared";

type AuditEntry = { id: number; action: string; target: string | null; created_at: string };

export function AuditWidget() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);

  useEffect(() => {
    fetch("/api/audit?limit=6")
      .then((r) => r.json())
      .then((d) => setEntries(d.entries ?? []))
      .catch(() => setEntries([]));
  }, []);

  if (entries === null) return <WidgetLoading />;
  if (entries.length === 0) return <p className="text-xs text-neutral-500">Aucune action enregistrée.</p>;

  return (
    <div className="space-y-2">
      <ul className="space-y-1.5 text-xs">
        {entries.map((e) => (
          <li key={e.id} className="flex justify-between gap-2 text-neutral-400">
            <span className="truncate">
              {e.action}
              {e.target ? <span className="text-neutral-600"> · {e.target}</span> : null}
            </span>
            <span className="shrink-0 text-neutral-600">{new Date(e.created_at).toLocaleTimeString()}</span>
          </li>
        ))}
      </ul>
      <a href="/audit" className="inline-block text-xs text-blue-600 hover:underline">
        Voir plus →
      </a>
    </div>
  );
}
