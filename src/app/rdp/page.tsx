"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";

const RdpViewer = dynamic(() => import("@/components/RdpViewer"), { ssr: false });

type Host = { id: number; name: string; kind: string; lan_ip: string | null; tailscale_ip: string | null; public_ip: string | null };
type RdpCredential = { port: number; username: string; created_at: string };

export default function RdpPage() {
  return (
    <Suspense fallback={null}>
      <RdpPageInner />
    </Suspense>
  );
}

function RdpPageInner() {
  const searchParams = useSearchParams();
  const [hosts, setHosts] = useState<Host[]>([]);
  const [activeHostId, setActiveHostId] = useState<number | null>(null);
  const [openHostIds, setOpenHostIds] = useState<number[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [statusByHost, setStatusByHost] = useState<Record<number, string>>({});
  const [credential, setCredential] = useState<RdpCredential | null>(null);
  const [showCredForm, setShowCredForm] = useState(false);
  const [credUsername, setCredUsername] = useState("");
  const [credPassword, setCredPassword] = useState("");
  const [credPort, setCredPort] = useState("3389");
  const [credError, setCredError] = useState("");

  const activeHost = hosts.find((h) => h.id === activeHostId) ?? null;

  function openHost(id: number) {
    setOpenHostIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    setActiveHostId(id);
    setModalOpen(true);
  }

  function closeHost(id: number) {
    setOpenHostIds((ids) => {
      const next = ids.filter((x) => x !== id);
      setActiveHostId((current) => {
        if (current !== id) return current;
        return next.length > 0 ? next[next.length - 1] : null;
      });
      if (next.length === 0) setModalOpen(false);
      return next;
    });
  }

  useEffect(() => {
    fetch("/api/hosts")
      .then((r) => r.json())
      .then((d) => {
        setHosts(d.hosts);
        const preselect = Number(searchParams.get("hostId"));
        if (preselect && d.hosts.some((h: Host) => h.id === preselect)) openHost(preselect);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadCredential = useCallback(async (hostId: number) => {
    const res = await fetch(`/api/hosts/${hostId}/rdp-credential`);
    const data = await res.json();
    setCredential(data.credential);
  }, []);

  useEffect(() => {
    if (activeHost) loadCredential(activeHost.id);
  }, [activeHost, loadCredential]);

  async function saveCredential(e: React.FormEvent) {
    e.preventDefault();
    if (!activeHost) return;
    setCredError("");
    try {
      const res = await fetch(`/api/hosts/${activeHost.id}/rdp-credential`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: credUsername, password: credPassword, port: Number(credPort) || 3389 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCredPassword("");
      setShowCredForm(false);
      loadCredential(activeHost.id);
    } catch (err) {
      setCredError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function deleteCredential() {
    if (!activeHost) return;
    await fetch(`/api/hosts/${activeHost.id}/rdp-credential`, { method: "DELETE" });
    setCredential(null);
  }

  function statusHandler(hostId: number) {
    return (status: string, message?: string) => {
      setStatusByHost((prev) => ({ ...prev, [hostId]: message ? `${status}: ${message}` : status }));
    };
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col gap-4 md:flex-row">
      <div className="w-full shrink-0 space-y-4 overflow-auto md:w-64">
        <div>
          <h1 className="text-lg font-semibold">Client RDP</h1>
          <p className="text-xs text-neutral-500">
            Se connecte à un bureau Windows distant, sans WebSocket — fonctionne même sur les
            réseaux qui le bloquent (hôtel, location...).
          </p>
        </div>

        <div className="space-y-1">
          {hosts.length === 0 && <p className="px-1 text-xs text-neutral-500">Aucune machine dans l&apos;inventaire.</p>}
          {hosts.map((h) => (
            <button
              key={h.id}
              onClick={() => openHost(h.id)}
              className={`block w-full rounded px-3 py-2 text-left text-sm ${
                activeHostId === h.id
                  ? "bg-blue-600/20 text-blue-300"
                  : openHostIds.includes(h.id)
                    ? "bg-neutral-900 text-neutral-200"
                    : "text-neutral-400 hover:bg-neutral-900"
              }`}
            >
              {h.name}
              {openHostIds.includes(h.id) && <span className="ml-1.5 text-emerald-400">●</span>}
              <div className="text-xs text-neutral-500">{h.tailscale_ip || h.lan_ip || h.public_ip || "pas d'IP"}</div>
            </button>
          ))}
        </div>

        {activeHost && (
          <div className="space-y-2 border-t border-neutral-800 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-neutral-400">Identifiant RDP</span>
              {!credential && (
                <button onClick={() => setShowCredForm((s) => !s)} className="text-xs text-blue-400 hover:underline">
                  + Configurer
                </button>
              )}
            </div>
            {credential && !showCredForm && (
              <div className="flex items-center justify-between text-xs text-neutral-400">
                <span>
                  🖥️ {credential.username}:{credential.port}
                </span>
                <div className="flex gap-2">
                  <button onClick={() => setShowCredForm(true)} className="text-blue-400 hover:underline">
                    modifier
                  </button>
                  <button onClick={deleteCredential} className="text-red-400 hover:underline">
                    suppr.
                  </button>
                </div>
              </div>
            )}
            {showCredForm && (
              <form onSubmit={saveCredential} className="space-y-2 rounded border border-neutral-800 p-2">
                <input
                  placeholder="Nom d'utilisateur Windows"
                  value={credUsername}
                  onChange={(e) => setCredUsername(e.target.value)}
                  required
                  className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs"
                />
                <input
                  type="password"
                  placeholder="Mot de passe"
                  value={credPassword}
                  onChange={(e) => setCredPassword(e.target.value)}
                  required
                  className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs"
                />
                <input
                  placeholder="Port (3389 par défaut)"
                  value={credPort}
                  onChange={(e) => setCredPort(e.target.value)}
                  className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs"
                />
                {credError && <p className="text-xs text-red-400">{credError}</p>}
                <button type="submit" className="w-full rounded bg-blue-600 text-white py-1 text-xs font-medium hover:bg-blue-500">
                  Enregistrer (chiffré)
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      <div
        className={`flex-1 flex-col ${
          modalOpen ? "fixed inset-0 z-50 bg-black/90 p-3 md:static md:z-auto md:bg-transparent md:p-0" : "hidden"
        } md:flex`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setModalOpen(false);
        }}
      >
        {activeHostId ? (
          <div className="flex h-full flex-col rounded border border-neutral-800 bg-black p-2">
            <div className="mb-2 flex items-center gap-1 overflow-x-auto">
              {openHostIds.map((id) => {
                const h = hosts.find((hh) => hh.id === id);
                return (
                  <div
                    key={id}
                    className={`flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-xs ${
                      id === activeHostId ? "bg-blue-600/20 text-blue-300" : "bg-neutral-900 text-neutral-400"
                    }`}
                  >
                    <button onClick={() => openHost(id)}>{h?.name ?? id}</button>
                    <button onClick={() => closeHost(id)} aria-label={`Fermer la connexion à ${h?.name ?? id}`} className="text-neutral-500 hover:text-red-400">
                      ✕
                    </button>
                  </div>
                );
              })}
              <button
                onClick={() => setModalOpen(false)}
                className="ml-auto shrink-0 rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-900 md:hidden"
              >
                Fermer (reste connecté)
              </button>
            </div>
            <div className="relative flex-1">
              {openHostIds.map((id) => (
                <div key={id} className={id === activeHostId ? "absolute inset-0" : "hidden"}>
                  <RdpViewer hostId={id} onStatusChange={statusHandler(id)} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="hidden h-full items-center justify-center text-sm text-neutral-500 md:flex">
            Sélectionne une machine pour ouvrir une session RDP.
          </div>
        )}
      </div>

      {activeHostId !== null && statusByHost[activeHostId] && (
        <div className={`${modalOpen ? "" : "hidden md:block"} fixed bottom-4 right-4 z-[60] rounded bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300 shadow`}>
          {statusByHost[activeHostId]}
        </div>
      )}
    </div>
  );
}
