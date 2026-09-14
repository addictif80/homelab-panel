"use client";

import { useEffect, useState } from "react";

export default function LockdownBanner() {
  const [active, setActive] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  function load() {
    fetch("/api/security/lockdown")
      .then((r) => r.json())
      .then((d) => setActive(d.active))
      .catch(() => {});
  }

  useEffect(() => {
    load();
  }, []);

  async function unlock() {
    setDeactivating(true);
    try {
      await fetch("/api/security/lockdown/deactivate", { method: "POST" });
      setActive(false);
    } finally {
      setDeactivating(false);
    }
  }

  if (!active) return null;

  return (
    <div className="border-b border-red-900 bg-red-950/50 px-4 py-2.5">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-red-200">
          🔒 Lockdown actif — sauvegardes automatiques en pause, sessions et appareils de confiance révoqués.
        </p>
        <button
          onClick={unlock}
          disabled={deactivating}
          className="rounded border border-red-700 bg-red-900/60 px-3 py-1.5 text-xs font-medium text-red-100 hover:bg-red-900 disabled:opacity-50"
        >
          {deactivating ? "..." : "Lever le lockdown"}
        </button>
      </div>
    </div>
  );
}
