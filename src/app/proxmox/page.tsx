"use client";

import { useCallback, useEffect, useState } from "react";

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

function formatUptime(seconds: number): string {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}j ${h % 24}h`;
  return `${h}h`;
}

export default function ProxmoxPage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [selectedHostId, setSelectedHostId] = useState<number | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [tokenId, setTokenId] = useState("root@pam!homelab");
  const [secret, setSecret] = useState("");
  const [verifySsl, setVerifySsl] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/hosts")
      .then((r) => r.json())
      .then((d) => {
        const physical = d.hosts.filter((h: Host) => h.kind === "physical");
        setHosts(physical);
        if (physical.length > 0) setSelectedHostId(physical[0].id);
      });
  }, []);

  const loadConfig = useCallback(async (hostId: number) => {
    const res = await fetch(`/api/proxmox/${hostId}/config`);
    const data = await res.json();
    setConfigured(data.configured);
  }, []);

  const loadResources = useCallback(async (hostId: number) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/proxmox/${hostId}/resources`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResources(data.resources);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
      setResources([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedHostId) return;
    loadConfig(selectedHostId).then(() => loadResources(selectedHostId));
  }, [selectedHostId, loadConfig, loadResources]);

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedHostId) return;
    setError("");
    try {
      const res = await fetch(`/api/proxmox/${selectedHostId}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenId, secret, verifySsl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowConfig(false);
      setSecret("");
      setConfigured(true);
      loadResources(selectedHostId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function runAction(r: Resource, action: "start" | "stop" | "shutdown" | "reboot") {
    if (!selectedHostId) return;
    setPending(`${r.vmid}-${action}`);
    try {
      const res = await fetch(`/api/proxmox/${selectedHostId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node: r.node, type: r.type, vmid: r.vmid, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTimeout(() => loadResources(selectedHostId), 1500);
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
          <h1 className="text-2xl font-semibold">Proxmox</h1>
          <p className="text-sm text-neutral-400">VM et conteneurs LXC du cluster.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedHostId ?? ""}
            onChange={(e) => setSelectedHostId(Number(e.target.value))}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          >
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => setShowConfig((s) => !s)}
            className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
          >
            {configured ? "Reconfigurer" : "Configurer l'API"}
          </button>
        </div>
      </div>

      {showConfig && (
        <form onSubmit={saveConfig} className="max-w-md space-y-3 rounded border border-neutral-800 p-4">
          <p className="text-xs text-neutral-400">
            Crée un token API dans Proxmox (Datacenter → Permissions → API Tokens) et colle ses
            informations ici. Le secret est chiffré avant stockage.
          </p>
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

      {!loading && configured === false && (
        <p className="text-sm text-neutral-500">
          Aucun token API configuré pour ce nœud. Clique sur &laquo; Configurer l&apos;API &raquo;.
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
