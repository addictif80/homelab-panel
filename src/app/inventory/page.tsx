"use client";

import { useEffect, useState } from "react";
import TopologyDiagram from "@/components/TopologyDiagram";

type Host = {
  id: number;
  name: string;
  kind: string;
  role: string | null;
  os: string | null;
  cluster: string | null;
  lan_ip: string | null;
  tailscale_ip: string | null;
  public_ip: string | null;
  docker_enabled: number;
  notes: string | null;
};

type Link = { id: number; host_a_id: number; host_b_id: number; link_type: string };

const KIND_LABELS: Record<string, string> = {
  physical: "Serveur physique",
  vm: "VM",
  lxc: "LXC",
  vps: "VPS",
  nas: "NAS",
  router: "Réseau",
};

type PingState = Record<number, "idle" | "checking" | "up" | "down" | "unknown">;

export default function InventoryPage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [tab, setTab] = useState<"list" | "topology">("list");
  const [pingState, setPingState] = useState<PingState>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/hosts")
      .then((r) => r.json())
      .then((d) => {
        setHosts(d.hosts);
        setLinks(d.links);
        setLoading(false);
      });
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Inventaire & topologie</h1>
          <p className="text-sm text-neutral-400">
            {hosts.length} machine{hosts.length > 1 ? "s" : ""} référencée
            {hosts.length > 1 ? "s" : ""}.
          </p>
        </div>
        <div className="flex rounded border border-neutral-800 text-sm">
          <button
            onClick={() => setTab("list")}
            className={`px-3 py-1.5 ${tab === "list" ? "bg-blue-600/20 text-blue-300" : "text-neutral-400"}`}
          >
            Liste
          </button>
          <button
            onClick={() => setTab("topology")}
            className={`px-3 py-1.5 ${tab === "topology" ? "bg-blue-600/20 text-blue-300" : "text-neutral-400"}`}
          >
            Schéma de maillage
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-neutral-500">Chargement...</p>
      ) : tab === "list" ? (
        <div className="overflow-auto rounded border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-left text-neutral-400">
              <tr>
                <th className="px-3 py-2 font-medium">Nom</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Rôle</th>
                <th className="px-3 py-2 font-medium">IP LAN</th>
                <th className="px-3 py-2 font-medium">IP Tailscale</th>
                <th className="px-3 py-2 font-medium">IP publique</th>
                <th className="px-3 py-2 font-medium">Statut</th>
              </tr>
            </thead>
            <tbody>
              {hosts.map((h) => (
                <tr key={h.id} className="border-t border-neutral-800">
                  <td className="px-3 py-2 font-medium">{h.name}</td>
                  <td className="px-3 py-2 text-neutral-400">{KIND_LABELS[h.kind] ?? h.kind}</td>
                  <td className="px-3 py-2 text-neutral-400">{h.role}</td>
                  <td className="px-3 py-2 font-mono text-xs">{h.lan_ip ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{h.tailscale_ip ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{h.public_ip ?? "—"}</td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <TopologyDiagram hosts={hosts} links={links} />
      )}
    </div>
  );
}
