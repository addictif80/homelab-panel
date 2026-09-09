"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Host = { id: number; name: string; kind: string };
type Resource = {
  vmid: number;
  node: string;
  type: "qemu" | "lxc";
  name: string;
  status: string;
  cpu: number;
  mem: number;
  maxmem: number;
  uptime: number;
};
type AggregatedResource = Resource & { hostId: number };

function formatUptime(seconds: number): string {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}j ${h % 24}h`;
  return `${h}h`;
}

export default function ProxmoxPage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [configuredHostIds, setConfiguredHostIds] = useState<number[]>([]);
  const [resources, setResources] = useState<AggregatedResource[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [configHostId, setConfigHostId] = useState<number | null>(null);
  const [tokenId, setTokenId] = useState("root@pam!homelab");
  const [secret, setSecret] = useState("");
  const [verifySsl, setVerifySsl] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const hostsRes = await fetch("/api/hosts");
      const hostsData = await hostsRes.json();
      const physical: Host[] = hostsData.hosts.filter((h: Host) => h.kind === "physical");
      setHosts(physical);
      if (physical.length > 0 && configHostId === null) setConfigHostId(physical[0].id);

      const configs = await Promise.all(
        physical.map(async (h) => {
          const res = await fetch(`/api/proxmox/${h.id}/config`);
          const data = await res.json();
          return { hostId: h.id, configured: data.configured as boolean };
        })
      );
      const configured = configs.filter((c) => c.configured).map((c) => c.hostId);
      setConfiguredHostIds(configured);

      if (configured.length === 0) {
        setResources([]);
        return;
      }

      const merged = new Map<string, AggregatedResource>();
      const errors: string[] = [];
      for (const hostId of configured) {
        const res = await fetch(`/api/proxmox/${hostId}/resources`);
        const data = await res.json();
        if (!res.ok) {
          errors.push(data.error);
          continue;
        }
        for (const r of data.resources as Resource[]) {
          const key = `${r.node}-${r.type}-${r.vmid}`;
          if (!merged.has(key)) merged.set(key, { ...r, hostId });
        }
      }
      setResources([...merged.values()].sort((a, b) => a.name.localeCompare(b.name)));
      if (errors.length > 0) setError(errors[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!configHostId) return;
    setError("");
    try {
      const res = await fetch(`/api/proxmox/${configHostId}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenId, secret, verifySsl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowConfig(false);
      setSecret("");
      loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function runAction(r: AggregatedResource, action: "start" | "stop" | "shutdown" | "reboot") {
    setPending(`${r.vmid}-${action}`);
    try {
      const res = await fetch(`/api/proxmox/${r.hostId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node: r.node, type: r.type, vmid: r.vmid, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTimeout(loadAll, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Serveurs VM</h1>
          <p className="text-sm text-neutral-400">
            VM et conteneurs LXC de tous les nœuds Proxmox configurés, en une seule vue.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowConfig((s) => !s)}
            className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
          >
            Gérer les connexions API
          </button>
          <Link
            href="/inventory"
            className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
          >
            Ajouter un nœud Proxmox
          </Link>
        </div>
      </div>

      {showConfig && (
        <form onSubmit={saveConfig} className="max-w-md space-y-3 rounded border border-neutral-800 p-4">
          <p className="text-xs text-neutral-400">
            Crée un token API dans Proxmox (Datacenter → Permissions → API Tokens) sur un nœud du
            cluster — les VM de tous les nœuds apparaîtront automatiquement.
          </p>
          <div>
            <label className="block text-xs mb-1">Nœud Proxmox</label>
            <select
              value={configHostId ?? ""}
              onChange={(e) => setConfigHostId(Number(e.target.value))}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
            >
              {hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} {configuredHostIds.includes(h.id) ? "(configuré)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1">Token ID</label>
            <input
              value={tokenId}
              onChange={(e) => setTokenId(e.target.value)}
              placeholder="root@pam!homelab"
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-xs mb-1">Secret</label>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              required
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-neutral-400">
            <input type="checkbox" checked={verifySsl} onChange={(e) => setVerifySsl(e.target.checked)} />
            Vérifier le certificat TLS
          </label>
          <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500">
            Enregistrer
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-neutral-500">Chargement...</p>}

      {!loading && configuredHostIds.length === 0 && (
        <p className="text-sm text-neutral-500">
          Aucun token API configuré. Clique sur &laquo; Gérer les connexions API &raquo;.
        </p>
      )}

      {resources.length > 0 && (
        <div className="overflow-auto rounded border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-left text-neutral-400">
              <tr>
                <th className="px-3 py-2 font-medium">Nom</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Nœud</th>
                <th className="px-3 py-2 font-medium">Statut</th>
                <th className="px-3 py-2 font-medium">RAM</th>
                <th className="px-3 py-2 font-medium">Uptime</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {resources.map((r) => (
                <tr key={`${r.node}-${r.vmid}`} className="border-t border-neutral-800">
                  <td className="px-3 py-2 font-medium">{r.name || `#${r.vmid}`}</td>
                  <td className="px-3 py-2 text-neutral-400">{r.type === "qemu" ? "VM" : "LXC"}</td>
                  <td className="px-3 py-2 text-neutral-400">{r.node}</td>
                  <td className="px-3 py-2">
                    <span className={r.status === "running" ? "text-green-400" : "text-neutral-500"}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-neutral-400">
                    {(r.maxmem / 1024 / 1024 / 1024).toFixed(1)} Go
                  </td>
                  <td className="px-3 py-2 text-neutral-400">{formatUptime(r.uptime)}</td>
                  <td className="px-3 py-2 space-x-2">
                    {r.status !== "running" ? (
                      <button
                        onClick={() => runAction(r, "start")}
                        disabled={pending === `${r.vmid}-start`}
                        className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800"
                      >
                        Démarrer
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => runAction(r, "shutdown")}
                          disabled={pending === `${r.vmid}-shutdown`}
                          className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800"
                        >
                          Arrêter
                        </button>
                        <button
                          onClick={() => runAction(r, "reboot")}
                          disabled={pending === `${r.vmid}-reboot`}
                          className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800"
                        >
                          Redémarrer
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
