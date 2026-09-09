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

export default function ServersPage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [pingState, setPingState] = useState<PingState>({});

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
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500"
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
                  {h.lan_ip ?? h.tailscale_ip ?? h.public_ip ?? "—"}
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
