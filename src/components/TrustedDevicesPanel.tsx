"use client";

import { useEffect, useState } from "react";

type TrustedDevice = {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
};

export default function TrustedDevicesPanel() {
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<TrustedDevice[] | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    fetch("/api/auth/trusted-devices")
      .then((r) => r.json())
      .then((data) => setDevices(data.devices || []));
  }

  useEffect(() => {
    if (open && !devices) load();
  }, [open, devices]);

  async function revoke(id: string) {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/auth/trusted-devices/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeAll() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/auth/trusted-devices", { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      setMessage("Tous les appareils ont été révoqués.");
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-neutral-300"
      >
        <span>Appareils de confiance (2FA)</span>
        <span className="text-neutral-500">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-neutral-800 p-4">
          <p className="text-xs text-neutral-500">
            Un appareil marqué « de confiance » lors de la connexion n&apos;a plus besoin de recomposer le code 2FA
            pendant 30 jours. Le mot de passe reste toujours requis.
          </p>
          {!devices ? (
            <p className="text-sm text-neutral-500">Chargement...</p>
          ) : devices.length === 0 ? (
            <p className="text-sm text-neutral-500">Aucun appareil de confiance enregistré.</p>
          ) : (
            <ul className="divide-y divide-neutral-800">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-neutral-200">{d.label || "Appareil inconnu"}</p>
                    <p className="text-xs text-neutral-500">
                      Ajouté le {new Date(`${d.createdAt}Z`).toLocaleDateString()} · expire le{" "}
                      {new Date(`${d.expiresAt}Z`).toLocaleDateString()}
                      {d.lastUsedAt && ` · utilisé le ${new Date(`${d.lastUsedAt}Z`).toLocaleDateString()}`}
                    </p>
                  </div>
                  <button
                    onClick={() => revoke(d.id)}
                    disabled={busy}
                    className="shrink-0 rounded border border-neutral-600 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                  >
                    Révoquer
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={revokeAll}
              disabled={busy || !devices || devices.length === 0}
              className="rounded border border-neutral-600 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
            >
              Révoquer tous les appareils
            </button>
            {message && <span className="text-xs text-neutral-400">{message}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
