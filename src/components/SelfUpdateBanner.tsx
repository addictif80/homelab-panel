"use client";

import { useEffect, useState } from "react";

type UpdateCheck = {
  currentVersion: string;
  latestVersion: string | null;
  changelog: string | null;
  updateAvailable: boolean;
};

type Job = { id: string; status: "running" | "success" | "failed"; log: string };

export default function SelfUpdateBanner() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setIsAdmin(d.role === "admin"))
      .catch(() => {});
    fetch("/api/updates/self/check")
      .then((r) => r.json())
      .then(setCheck)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!job || job.status !== "running") return;
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/updates/self/jobs/${job.id}`);
      const data = await res.json();
      if (res.ok) setJob(data.job);
    }, 2000);
    return () => clearTimeout(timer);
  }, [job]);

  useEffect(() => {
    if (job?.status !== "success") return;
    // The process is about to exit and be restarted by its supervisor — keep retrying the
    // reload until the new process answers again, rather than leaving the user on a dead page.
    const timer = setInterval(() => {
      fetch("/", { method: "HEAD" })
        .then(() => window.location.reload())
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [job]);

  async function applyUpdate() {
    if (!confirm(`Installer la mise à jour vers la version ${check?.latestVersion} ? Le panel redémarrera automatiquement.`)) {
      return;
    }
    setError("");
    try {
      const res = await fetch("/api/updates/self/apply", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setJob({ id: data.jobId, status: "running", log: "" });
      setShowLog(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    }
  }

  if (!isAdmin || dismissed || !check?.updateAvailable) return null;

  return (
    <div className="border-b border-neutral-800 bg-neutral-900/60 px-4 py-3">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-neutral-100">
            Nouvelle version disponible — v{check.latestVersion}{" "}
            <span className="font-normal text-neutral-500">(actuelle : v{check.currentVersion})</span>
          </p>
          {check.changelog && <p className="mt-0.5 max-w-2xl text-xs text-neutral-400">{check.changelog}</p>}
        </div>
        <div className="flex items-center gap-2">
          {job ? (
            <button
              onClick={() => setShowLog((s) => !s)}
              className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
            >
              {job.status === "running" ? "Mise à jour en cours..." : job.status === "success" ? "Redémarrage..." : "Voir l'erreur"}
            </button>
          ) : (
            <>
              <button onClick={applyUpdate} className="btn-primary px-3 py-1.5 text-sm">
                Mettre à jour
              </button>
              <button
                onClick={() => setDismissed(true)}
                className="rounded px-2 py-1.5 text-xs text-neutral-500 hover:text-neutral-300"
              >
                Plus tard
              </button>
            </>
          )}
        </div>
      </div>
      {error && <p className="mx-auto mt-2 max-w-5xl text-xs text-red-400">{error}</p>}
      {showLog && job && (
        <pre className="mx-auto mt-3 max-w-5xl overflow-auto rounded border border-neutral-800 bg-black p-3 font-mono text-xs text-neutral-300" style={{ maxHeight: 220 }}>
          {job.log || "Démarrage..."}
        </pre>
      )}
    </div>
  );
}
