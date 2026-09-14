"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Host = {
  id: number;
  name: string;
  kind: string;
  role: string | null;
  os: string | null;
  lan_ip: string | null;
  tailscale_ip: string | null;
  public_ip: string | null;
  update_method: string | null;
};

const KIND_LABELS: Record<string, string> = {
  physical: "Serveur physique",
  vps: "VPS",
  nas: "NAS",
  router: "Réseau",
};

type PingState = Record<number, "idle" | "checking" | "up" | "down" | "unknown">;
type Impact = {
  childHosts: { id: number; name: string; kind: string }[];
  linkedHosts: { id: number; name: string; link_type: string }[];
  containers: { id: string; name: string }[];
};

export default function ServersPage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [pingState, setPingState] = useState<PingState>({});
  const [restarting, setRestarting] = useState<number | null>(null);
  const [confirmingRestart, setConfirmingRestart] = useState<Host | null>(null);
  const [restartMsg, setRestartMsg] = useState("");
  const [impact, setImpact] = useState<Impact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);

  useEffect(() => {
    fetch("/api/hosts")
      .then((r) => r.json())
      .then((d) =>
        setHosts(d.hosts.filter((h: Host) => ["physical", "vps", "nas", "router"].includes(h.kind)))
      );
  }, []);

  async function checkHost(id: number) {
    setPingState((s) => ({ ...s, [id]: "checking" }));
    try {
      const res = await fetch(`/api/hosts/${id}/ping`, { method: "POST" });
      const data = await res.json();
      setPingState((s) => ({
        ...s,
        [id]: data.reachable === null ? "unknown" : data.reachable ? "up" : "down",
      }));
    } catch {
      setPingState((s) => ({ ...s, [id]: "unknown" }));
    }
  }

  function openRestartConfirm(host: Host) {
    setConfirmingRestart(host);
    setImpact(null);
    setImpactLoading(true);
    fetch(`/api/hosts/${host.id}/impact`)
      .then((r) => r.json())
      .then((d) => setImpact(d))
      .catch(() => setImpact(null))
      .finally(() => setImpactLoading(false));
  }

  async function confirmRestart() {
    if (!confirmingRestart) return;
    const hostId = confirmingRestart.id;
    setRestarting(hostId);
    setRestartMsg("");
    try {
      const res = await fetch(`/api/hosts/${hostId}/restart`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Échec du redémarrage.");
      setRestartMsg(data.message);
      setPingState((s) => ({ ...s, [hostId]: "idle" }));
    } catch (err) {
      setRestartMsg(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setRestarting(null);
      setConfirmingRestart(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Serveurs physiques</h1>
          <p className="text-sm text-neutral-400">
            Machines auxquelles tu te connectes directement en SSH (serveurs, NAS, VPS, routeur) —
            par opposition aux VM Proxmox et aux conteneurs Docker.
          </p>
        </div>
        <Link
          href="/inventory"
          className="rounded bg-blue-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-blue-500"
        >
          + Ajouter / modifier une machine
        </Link>
      </div>

      <div className="overflow-auto rounded border border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900 text-left text-neutral-400">
            <tr>
              <th className="px-3 py-2 font-medium">Nom</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Rôle</th>
              <th className="px-3 py-2 font-medium">Adresse</th>
              <th className="px-3 py-2 font-medium">Statut</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {hosts.map((h) => (
              <tr key={h.id} className="border-t border-neutral-800">
                <td className="px-3 py-2 font-medium">{h.name}</td>
                <td className="px-3 py-2 text-neutral-400">{KIND_LABELS[h.kind] ?? h.kind}</td>
                <td className="px-3 py-2 text-neutral-400">{h.role}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {h.tailscale_ip ?? h.lan_ip ?? h.public_ip ?? "—"}
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => checkHost(h.id)}
                    className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800"
                  >
                    {pingState[h.id] === "checking"
                      ? "..."
                      : pingState[h.id] === "up"
                        ? "🟢 up"
                        : pingState[h.id] === "down"
                          ? "🔴 down"
                          : pingState[h.id] === "unknown"
                            ? "⚪ ?"
                            : "Vérifier"}
                  </button>
                </td>
                <td className="px-3 py-2 space-x-2">
                  <Link
                    href={`/ssh?hostId=${h.id}`}
                    className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800"
                  >
                    SSH
                  </Link>
                  {h.update_method && (
                    <Link
                      href="/updates"
                      className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800"
                    >
                      Mises à jour
                    </Link>
                  )}
                  {h.kind === "physical" && (
                    <button
                      onClick={() => openRestartConfirm(h)}
                      disabled={restarting === h.id}
                      className="rounded border border-amber-800 bg-amber-950/30 px-2 py-0.5 text-xs text-amber-300 hover:bg-amber-950/60 disabled:opacity-50"
                    >
                      {restarting === h.id ? "..." : "Redémarrer"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {restartMsg && <p className="text-sm text-neutral-400">{restartMsg}</p>}

      {confirmingRestart && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded border border-neutral-700 bg-neutral-900 p-5">
            <h2 className="text-sm font-semibold text-neutral-100">Redémarrer « {confirmingRestart.name} » ?</h2>
            <p className="mt-2 text-sm text-neutral-300">
              La machine va redémarrer immédiatement. Tout service qu&apos;elle héberge sera interrompu le temps du
              redémarrage.
            </p>

            <div className="mt-3 rounded border border-amber-900/50 bg-amber-950/20 p-3 text-sm">
              {impactLoading ? (
                <p className="text-neutral-400">Analyse de l&apos;impact...</p>
              ) : impact && (impact.childHosts.length || impact.linkedHosts.length || impact.containers.length) ? (
                <div className="space-y-2 text-amber-200">
                  <p className="font-medium">Ce qui sera aussi affecté :</p>
                  {impact.childHosts.length > 0 && (
                    <p>
                      <span className="text-neutral-400">VM/CT hébergées : </span>
                      {impact.childHosts.map((h) => h.name).join(", ")}
                    </p>
                  )}
                  {impact.containers.length > 0 && (
                    <p>
                      <span className="text-neutral-400">Conteneurs Docker actifs : </span>
                      {impact.containers.map((c) => c.name).join(", ")}
                    </p>
                  )}
                  {impact.linkedHosts.length > 0 && (
                    <p>
                      <span className="text-neutral-400">Machines liées dans la topologie : </span>
                      {impact.linkedHosts.map((h) => `${h.name} (${h.link_type})`).join(", ")}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-neutral-500">Aucune VM, conteneur ou machine liée détecté pour cet hôte.</p>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmingRestart(null)}
                disabled={restarting !== null}
                className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
              >
                Annuler
              </button>
              <button
                onClick={confirmRestart}
                disabled={restarting !== null}
                className="rounded border border-amber-700 bg-amber-900/40 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-900/60 disabled:opacity-50"
              >
                {restarting !== null ? "Redémarrage..." : "Confirmer le redémarrage"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
