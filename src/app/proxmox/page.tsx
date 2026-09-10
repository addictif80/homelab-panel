"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Host = { id: number; name: string; kind: string; proxmox_node: string | null };
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
type Snapshot = { name: string; description?: string; snaptime?: number; vmstate?: number };

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

  const [showCreate, setShowCreate] = useState(false);
  const [createHostId, setCreateHostId] = useState<number | null>(null);
  const [newVm, setNewVm] = useState({
    vmid: "",
    name: "",
    cores: "2",
    memoryMb: "2048",
    diskSpec: "local-lvm:32",
    isoSpec: "",
    bridge: "vmbr0",
  });
  const [creating, setCreating] = useState(false);

  const [snapTarget, setSnapTarget] = useState<AggregatedResource | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapLoading, setSnapLoading] = useState(false);
  const [snapError, setSnapError] = useState("");
  const [newSnapName, setNewSnapName] = useState("");
  const [newSnapDesc, setNewSnapDesc] = useState("");
  const [newSnapRam, setNewSnapRam] = useState(false);
  const [snapBusy, setSnapBusy] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const hostsRes = await fetch("/api/hosts");
      const hostsData = await hostsRes.json();
      const physical: Host[] = hostsData.hosts.filter((h: Host) => h.kind === "physical");
      setHosts(physical);
      if (physical.length > 0 && configHostId === null) setConfigHostId(physical[0].id);
      if (physical.length > 0 && createHostId === null) setCreateHostId(physical[0].id);

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

  async function deleteVm(r: AggregatedResource) {
    if (!confirm(`Supprimer définitivement ${r.name || `#${r.vmid}`} (${r.type === "qemu" ? "VM" : "LXC"}) ? Cette action est irréversible.`)) {
      return;
    }
    await runAction(r, "delete");
  }

  async function createVm(e: React.FormEvent) {
    e.preventDefault();
    if (!createHostId) return;
    const node = hosts.find((h) => h.id === createHostId)?.proxmox_node;
    if (!node) {
      setError("Ce nœud n'a pas de nom Proxmox renseigné dans l'inventaire.");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const res = await fetch(`/api/proxmox/${createHostId}/vm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          node,
          vmid: Number(newVm.vmid),
          name: newVm.name,
          cores: Number(newVm.cores),
          memoryMb: Number(newVm.memoryMb),
          diskSpec: newVm.diskSpec,
          isoSpec: newVm.isoSpec || undefined,
          bridge: newVm.bridge,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowCreate(false);
      setNewVm({ vmid: "", name: "", cores: "2", memoryMb: "2048", diskSpec: "local-lvm:32", isoSpec: "", bridge: "vmbr0" });
      loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setCreating(false);
    }
  }

  async function openSnapshots(r: AggregatedResource) {
    setSnapTarget(r);
    setSnapError("");
    setNewSnapName("");
    setNewSnapDesc("");
    setNewSnapRam(false);
    setSnapLoading(true);
    try {
      const res = await fetch(
        `/api/proxmox/${r.hostId}/snapshots?node=${r.node}&type=${r.type}&vmid=${r.vmid}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSnapshots(data.snapshots);
    } catch (err) {
      setSnapError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSnapLoading(false);
    }
  }

  async function createSnapshot(e: React.FormEvent) {
    e.preventDefault();
    if (!snapTarget) return;
    setSnapBusy("create");
    setSnapError("");
    try {
      const res = await fetch(`/api/proxmox/${snapTarget.hostId}/snapshots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          node: snapTarget.node,
          type: snapTarget.type,
          vmid: snapTarget.vmid,
          name: newSnapName,
          description: newSnapDesc || undefined,
          includeRamState: newSnapRam,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await openSnapshots(snapTarget);
    } catch (err) {
      setSnapError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSnapBusy(null);
    }
  }

  async function rollbackSnapshot(name: string) {
    if (!snapTarget) return;
    if (!confirm(`Revenir à l'état du snapshot « ${name} » ? Les changements depuis seront perdus.`)) return;
    setSnapBusy(`rollback-${name}`);
    setSnapError("");
    try {
      const res = await fetch(`/api/proxmox/${snapTarget.hostId}/snapshots/${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node: snapTarget.node, type: snapTarget.type, vmid: snapTarget.vmid, action: "rollback" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await openSnapshots(snapTarget);
      loadAll();
    } catch (err) {
      setSnapError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSnapBusy(null);
    }
  }

  async function deleteSnapshot(name: string) {
    if (!snapTarget) return;
    if (!confirm(`Supprimer le snapshot « ${name} » ?`)) return;
    setSnapBusy(`delete-${name}`);
    setSnapError("");
    try {
      const res = await fetch(
        `/api/proxmox/${snapTarget.hostId}/snapshots/${encodeURIComponent(name)}?node=${snapTarget.node}&type=${snapTarget.type}&vmid=${snapTarget.vmid}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await openSnapshots(snapTarget);
    } catch (err) {
      setSnapError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSnapBusy(null);
    }
  }

  async function runAction(r: AggregatedResource, action: "start" | "stop" | "shutdown" | "reboot" | "delete") {
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
            onClick={() => setShowCreate((s) => !s)}
            className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1 text-sm text-blue-200 hover:bg-blue-900/60"
          >
            + Créer une VM
          </button>
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

      {showCreate && (
        <form onSubmit={createVm} className="max-w-2xl space-y-3 rounded border border-neutral-800 p-4">
          <p className="text-xs text-neutral-400">
            Crée une VM QEMU avec un disque, une carte réseau et éventuellement un ISO monté — pour tout réglage plus
            fin (BIOS, disques multiples...), édite-la ensuite depuis l&apos;UI Proxmox elle-même.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-400">Nœud Proxmox</span>
              <select
                value={createHostId ?? ""}
                onChange={(e) => setCreateHostId(Number(e.target.value))}
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              >
                {hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name} {h.proxmox_node ? `(${h.proxmox_node})` : "— nœud non renseigné"}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-400">VMID</span>
              <input
                value={newVm.vmid}
                onChange={(e) => setNewVm({ ...newVm, vmid: e.target.value })}
                placeholder="110"
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-400">Nom</span>
              <input
                value={newVm.name}
                onChange={(e) => setNewVm({ ...newVm, name: e.target.value })}
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-400">Cœurs CPU</span>
              <input
                type="number"
                min={1}
                value={newVm.cores}
                onChange={(e) => setNewVm({ ...newVm, cores: e.target.value })}
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-400">Mémoire (Mo)</span>
              <input
                type="number"
                min={256}
                value={newVm.memoryMb}
                onChange={(e) => setNewVm({ ...newVm, memoryMb: e.target.value })}
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-400">Disque (stockage:taille en Go)</span>
              <input
                value={newVm.diskSpec}
                onChange={(e) => setNewVm({ ...newVm, diskSpec: e.target.value })}
                placeholder="local-lvm:32"
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-400">ISO à monter (optionnel)</span>
              <input
                value={newVm.isoSpec}
                onChange={(e) => setNewVm({ ...newVm, isoSpec: e.target.value })}
                placeholder="local:iso/debian-12.iso"
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-400">Bridge réseau</span>
              <input
                value={newVm.bridge}
                onChange={(e) => setNewVm({ ...newVm, bridge: e.target.value })}
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={creating}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            {creating ? "Création..." : "Créer la VM"}
          </button>
        </form>
      )}

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
                    <button
                      onClick={() => openSnapshots(r)}
                      className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800"
                    >
                      Snapshots
                    </button>
                    <button
                      onClick={() => deleteVm(r)}
                      disabled={pending === `${r.vmid}-delete`}
                      className="rounded border border-red-900 px-2 py-0.5 text-xs text-red-300 hover:bg-red-950/40"
                    >
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {snapTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSnapTarget(null)}>
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-auto rounded border border-neutral-800 bg-neutral-900 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                Snapshots — {snapTarget.name || `#${snapTarget.vmid}`}
              </h2>
              <button onClick={() => setSnapTarget(null)} className="text-neutral-400 hover:text-neutral-200">
                ✕
              </button>
            </div>

            {snapError && <p className="mb-2 text-sm text-red-400">{snapError}</p>}

            <form onSubmit={createSnapshot} className="mb-4 space-y-2 rounded border border-neutral-800 p-3">
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={newSnapName}
                  onChange={(e) => setNewSnapName(e.target.value)}
                  placeholder="Nom du snapshot"
                  required
                  className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm"
                />
                <input
                  value={newSnapDesc}
                  onChange={(e) => setNewSnapDesc(e.target.value)}
                  placeholder="Description (optionnel)"
                  className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm"
                />
              </div>
              {snapTarget.type === "qemu" && (
                <label className="flex items-center gap-2 text-xs text-neutral-400">
                  <input type="checkbox" checked={newSnapRam} onChange={(e) => setNewSnapRam(e.target.checked)} />
                  Inclure l&apos;état de la RAM (VM en cours d&apos;exécution)
                </label>
              )}
              <button
                type="submit"
                disabled={snapBusy === "create"}
                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium hover:bg-blue-500 disabled:opacity-50"
              >
                {snapBusy === "create" ? "Création..." : "Créer un snapshot"}
              </button>
            </form>

            {snapLoading ? (
              <p className="text-sm text-neutral-500">Chargement...</p>
            ) : snapshots.length === 0 ? (
              <p className="text-sm text-neutral-500">Aucun snapshot pour cette machine.</p>
            ) : (
              <ul className="divide-y divide-neutral-800">
                {snapshots.map((s) => (
                  <li key={s.name} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate text-neutral-200">
                        {s.name} {s.vmstate ? <span className="text-xs text-neutral-500">(avec RAM)</span> : null}
                      </p>
                      {s.description && <p className="truncate text-xs text-neutral-500">{s.description}</p>}
                      {s.snaptime && (
                        <p className="text-xs text-neutral-500">{new Date(s.snaptime * 1000).toLocaleString()}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => rollbackSnapshot(s.name)}
                        disabled={!!snapBusy}
                        className="rounded border border-neutral-600 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                      >
                        {snapBusy === `rollback-${s.name}` ? "..." : "Restaurer"}
                      </button>
                      <button
                        onClick={() => deleteSnapshot(s.name)}
                        disabled={!!snapBusy}
                        className="rounded border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40 disabled:opacity-50"
                      >
                        {snapBusy === `delete-${s.name}` ? "..." : "Supprimer"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
