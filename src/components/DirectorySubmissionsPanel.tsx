"use client";

import { useEffect, useState } from "react";

type Status = "pending" | "approved" | "rejected";
type Submission = {
  id: string;
  ownerName: string;
  serviceName: string;
  serviceUrl: string;
  description: string;
  faviconDataUrl: string | null;
  screenshotDataUrl: string | null;
  status: Status;
  createdAt: string;
};

const STATUS_LABEL: Record<Status, string> = { pending: "En attente", approved: "Publié", rejected: "Refusé" };
const STATUS_STYLE: Record<Status, string> = {
  pending: "border-amber-900 bg-amber-950/30 text-amber-300",
  approved: "border-emerald-900 bg-emerald-950/30 text-emerald-300",
  rejected: "border-red-900 bg-red-950/30 text-red-300",
};

export default function DirectorySubmissionsPanel() {
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  function load() {
    fetch("/api/seller/directory")
      .then((r) => r.json())
      .then((d) => setSubmissions(d.submissions));
  }

  useEffect(() => {
    load();
  }, []);

  async function review(id: string, status: "approved" | "rejected") {
    setBusyId(id);
    try {
      await fetch(`/api/seller/directory/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (!confirm("Supprimer définitivement cette soumission ?")) return;
    setBusyId(id);
    try {
      await fetch(`/api/seller/directory/${id}`, { method: "DELETE" });
      load();
    } finally {
      setBusyId(null);
    }
  }

  const visible = submissions?.filter((s) => filter === "all" || s.status === "pending") ?? [];
  const pendingCount = submissions?.filter((s) => s.status === "pending").length ?? 0;

  return (
    <section className="space-y-3 rounded border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-100">
          Annuaire public {pendingCount > 0 ? `— ${pendingCount} en attente` : ""}
        </h2>
        <div className="flex gap-1.5 text-xs">
          <button
            onClick={() => setFilter("pending")}
            className={`rounded border px-2 py-1 ${filter === "pending" ? "border-blue-700 bg-blue-900/40 text-blue-200" : "border-neutral-700 text-neutral-400 hover:bg-neutral-800"}`}
          >
            En attente
          </button>
          <button
            onClick={() => setFilter("all")}
            className={`rounded border px-2 py-1 ${filter === "all" ? "border-blue-700 bg-blue-900/40 text-blue-200" : "border-neutral-700 text-neutral-400 hover:bg-neutral-800"}`}
          >
            Toutes
          </button>
        </div>
      </div>
      <p className="text-xs text-neutral-500">
        Services soumis par les clients depuis la case « Annuaire » de leur page /services. Approuver les fait
        apparaître dans la section « Annuaire » de la landing page /store.
      </p>

      <div className="divide-y divide-neutral-800 rounded border border-neutral-800">
        {visible.map((s) => (
          <div key={s.id} className="flex items-center gap-3 p-3 text-sm">
            {s.screenshotDataUrl && (
              <img src={s.screenshotDataUrl} alt="" className="h-12 w-20 shrink-0 rounded border border-neutral-800 object-cover object-top" />
            )}
            {s.faviconDataUrl ? (
              <img src={s.faviconDataUrl} alt="" className="h-8 w-8 shrink-0 rounded" />
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-blue-900/40 text-xs font-semibold text-blue-300">
                {s.serviceName.charAt(0).toUpperCase() || "?"}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-neutral-100">
                {s.serviceName} <span className="text-neutral-500">— {s.ownerName}</span>
              </p>
              <p className="truncate text-xs text-neutral-500">{s.serviceUrl}</p>
              {s.description && <p className="truncate text-xs text-neutral-500">{s.description}</p>}
            </div>
            <span className={`shrink-0 rounded border px-2 py-0.5 text-[11px] ${STATUS_STYLE[s.status]}`}>
              {STATUS_LABEL[s.status]}
            </span>
            <div className="flex shrink-0 gap-1.5">
              {s.status !== "approved" && (
                <button
                  onClick={() => review(s.id, "approved")}
                  disabled={busyId === s.id}
                  className="rounded border border-emerald-800 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-950/40 disabled:opacity-50"
                >
                  Approuver
                </button>
              )}
              {s.status !== "rejected" && (
                <button
                  onClick={() => review(s.id, "rejected")}
                  disabled={busyId === s.id}
                  className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
                >
                  Refuser
                </button>
              )}
              <button
                onClick={() => remove(s.id)}
                disabled={busyId === s.id}
                className="rounded border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40 disabled:opacity-50"
              >
                Supprimer
              </button>
            </div>
          </div>
        ))}
        {visible.length === 0 && (
          <p className="p-4 text-center text-sm text-neutral-600">
            {filter === "pending" ? "Aucune soumission en attente." : "Aucune soumission pour l'instant."}
          </p>
        )}
      </div>
    </section>
  );
}
