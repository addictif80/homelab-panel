"use client";

import { useEffect, useState } from "react";

type Incident = {
  id: string;
  type: "host_down" | "backup_failed";
  hostName: string;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number;
  detail: string;
  story: string;
};

const TYPE_LABELS: Record<Incident["type"], string> = {
  host_down: "Machine injoignable",
  backup_failed: "Sauvegarde échouée",
};

/** The story text only ever uses "## heading", "**bold**" and plain paragraphs (see
 * generateIncidentStory) — a tiny inline renderer for that fixed subset beats a markdown
 * dependency for three patterns. */
function renderStory(text: string) {
  return text.split("\n").map((line, idx) => {
    if (line.startsWith("## ")) {
      return (
        <h3 key={idx} className="mt-3 text-base font-semibold text-neutral-100">
          {line.slice(3)}
        </h3>
      );
    }
    if (line.trim() === "") return <div key={idx} className="h-2" />;
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return (
      <p key={idx} className="text-sm leading-relaxed text-neutral-300">
        {parts.map((p, i) => (p.startsWith("**") ? <strong key={i} className="text-neutral-100">{p.slice(2, -2)}</strong> : p))}
      </p>
    );
  });
}

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/incidents")
      .then((r) => r.json())
      .then((d) => setIncidents(d.incidents ?? []));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Incidents</h1>
        <p className="text-sm text-neutral-400">
          Détectés automatiquement depuis la surveillance en direct (24 dernières heures) et l&apos;historique des
          sauvegardes (30 derniers jours) — aucune saisie manuelle. Clique sur un incident pour voir son récap.
        </p>
      </div>

      {incidents === null && <p className="text-sm text-neutral-500">Chargement...</p>}
      {incidents && incidents.length === 0 && (
        <p className="rounded border border-emerald-900 bg-emerald-950/20 p-4 text-sm text-emerald-300">
          Aucun incident détecté récemment. 🎉
        </p>
      )}

      <div className="space-y-2">
        {incidents?.map((incident) => {
          const open = openId === incident.id;
          return (
            <div key={incident.id} className="rounded border border-neutral-800 bg-neutral-900">
              <button
                onClick={() => setOpenId(open ? null : incident.id)}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
              >
                <div>
                  <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    {TYPE_LABELS[incident.type]}
                  </span>
                  <p className="text-sm text-neutral-100">
                    {incident.hostName} — {incident.detail}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-neutral-500">
                  {new Date(`${incident.startedAt}Z`).toLocaleString("fr-FR")}
                </span>
              </button>
              {open && <div className="border-t border-neutral-800 px-4 py-3">{renderStory(incident.story)}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
