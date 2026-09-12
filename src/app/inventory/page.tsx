"use client";

import { useCallback, useEffect, useState } from "react";
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
  ssh_port: number;
  ssh_user: string | null;
  docker_enabled: number;
  update_method: string | null;
  needs_sudo: number;
  proxmox_node: string | null;
  notes: string | null;
};

type Link = { id: number; host_a_id: number; host_b_id: number; link_type: string };

const LINK_TYPE_LABELS: Record<string, string> = {
  lan: "Lien LAN",
  tailscale: "Lien Tailscale",
  cluster: "Cluster Proxmox",
  network: "Réseau (générique)",
};
const LINK_TYPE_OPTIONS = Object.keys(LINK_TYPE_LABELS);

const KIND_LABELS: Record<string, string> = {
  physical: "Serveur physique",
  vm: "VM",
  lxc: "LXC",
  vps: "VPS",
  nas: "NAS",
  router: "Réseau",
};

const KIND_OPTIONS = Object.keys(KIND_LABELS);
const UPDATE_METHOD_OPTIONS = ["apt", "opkg", "dsm"];

type PingState = Record<number, "idle" | "checking" | "up" | "down" | "unknown">;

type FormState = {
  name: string;
  kind: string;
  role: string;
  os: string;
  cluster: string;
  lan_ip: string;
  tailscale_ip: string;
  public_ip: string;
  ssh_port: string;
  ssh_user: string;
  docker_enabled: boolean;
  update_method: string;
  needs_sudo: boolean;
  proxmox_node: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  kind: "physical",
  role: "",
  os: "",
  cluster: "",
  lan_ip: "",
  tailscale_ip: "",
  public_ip: "",
  ssh_port: "22",
  ssh_user: "",
  docker_enabled: false,
  update_method: "",
  needs_sudo: true,
  proxmox_node: "",
  notes: "",
};

function hostToForm(h: Host): FormState {
  return {
    name: h.name,
    kind: h.kind,
    role: h.role ?? "",
    os: h.os ?? "",
    cluster: h.cluster ?? "",
    lan_ip: h.lan_ip ?? "",
    tailscale_ip: h.tailscale_ip ?? "",
    public_ip: h.public_ip ?? "",
    ssh_port: String(h.ssh_port ?? 22),
    ssh_user: h.ssh_user ?? "",
    docker_enabled: !!h.docker_enabled,
    update_method: h.update_method ?? "",
    needs_sudo: !!h.needs_sudo,
    proxmox_node: h.proxmox_node ?? "",
    notes: h.notes ?? "",
  };
}

function formToPayload(f: FormState) {
  return {
    name: f.name,
    kind: f.kind,
    role: f.role || null,
    os: f.os || null,
    cluster: f.cluster || null,
    lan_ip: f.lan_ip || null,
    tailscale_ip: f.tailscale_ip || null,
    public_ip: f.public_ip || null,
    ssh_port: Number(f.ssh_port) || 22,
    ssh_user: f.ssh_user || null,
    docker_enabled: f.docker_enabled,
    update_method: f.update_method || null,
    needs_sudo: f.needs_sudo,
    proxmox_node: f.proxmox_node || null,
    notes: f.notes || null,
  };
}

export default function InventoryPage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [tab, setTab] = useState<"list" | "topology">("list");
  const [pingState, setPingState] = useState<PingState>({});
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [linkForm, setLinkForm] = useState({ host_a_id: "", host_b_id: "", link_type: "lan" });
  const [linkError, setLinkError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/hosts");
    const data = await res.json();
    setHosts(data.hosts);
    setLinks(data.links);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A device found by /discovery can hand off here to pre-fill the "add machine" form instead of
  // duplicating host-creation logic in two places.
  useEffect(() => {
    const raw = sessionStorage.getItem("discoveryPrefillHost");
    if (!raw) return;
    sessionStorage.removeItem("discoveryPrefillHost");
    try {
      const prefill = JSON.parse(raw) as Partial<FormState>;
      setForm({ ...EMPTY_FORM, ...prefill });
      setFormError("");
      setEditingId("new");
    } catch {
      // ignore malformed prefill
    }
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

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormError("");
    setEditingId("new");
  }

  function openEdit(h: Host) {
    setForm(hostToForm(h));
    setFormError("");
    setEditingId(h.id);
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    try {
      const payload = formToPayload(form);
      const res =
        editingId === "new"
          ? await fetch("/api/hosts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
          : await fetch(`/api/hosts/${editingId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEditingId(null);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function deleteHost(h: Host) {
    if (!confirm(`Supprimer ${h.name} ? Ses identifiants SSH associés seront aussi supprimés.`)) return;
    await fetch(`/api/hosts/${h.id}`, { method: "DELETE" });
    load();
  }

  async function addLink(e: React.FormEvent) {
    e.preventDefault();
    setLinkError("");
    try {
      const res = await fetch("/api/hosts/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host_a_id: Number(linkForm.host_a_id),
          host_b_id: Number(linkForm.host_b_id),
          link_type: linkForm.link_type,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setLinkForm({ host_a_id: "", host_b_id: "", link_type: "lan" });
      load();
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function deleteLink(id: number) {
    await fetch(`/api/hosts/links/${id}`, { method: "DELETE" });
    load();
  }

  function hostName(id: number): string {
    return hosts.find((h) => h.id === id)?.name ?? `#${id}`;
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
        <div className="flex items-center gap-2">
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
          <button
            onClick={openCreate}
            className="rounded bg-blue-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-blue-500"
          >
            + Ajouter une machine
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
                <th className="px-3 py-2 font-medium">Actions</th>
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
                  <td className="px-3 py-2 space-x-2">
                    <button
                      onClick={() => openEdit(h)}
                      className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800"
                    >
                      Modifier
                    </button>
                    <button
                      onClick={() => deleteHost(h)}
                      className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-red-400 hover:bg-neutral-800"
                    >
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-4">
          <TopologyDiagram hosts={hosts} links={links} />

          <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
            <h2 className="text-sm font-semibold text-neutral-100">Liens réseau</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Ce sont ces liens qui dessinent le schéma ci-dessus (et les connexions de la Vue vivante). Ils
              ne sont pas déduits automatiquement — ajoute ou supprime-les ici pour qu&apos;ils reflètent ton
              réseau réel.
            </p>

            <form onSubmit={addLink} className="mt-3 flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-xs mb-1 text-neutral-400">Machine A</label>
                <select
                  value={linkForm.host_a_id}
                  onChange={(e) => setLinkForm({ ...linkForm, host_a_id: e.target.value })}
                  className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm"
                  required
                >
                  <option value="" disabled>
                    Choisir...
                  </option>
                  {hosts.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1 text-neutral-400">Machine B</label>
                <select
                  value={linkForm.host_b_id}
                  onChange={(e) => setLinkForm({ ...linkForm, host_b_id: e.target.value })}
                  className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm"
                  required
                >
                  <option value="" disabled>
                    Choisir...
                  </option>
                  {hosts.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1 text-neutral-400">Type</label>
                <select
                  value={linkForm.link_type}
                  onChange={(e) => setLinkForm({ ...linkForm, link_type: e.target.value })}
                  className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm"
                >
                  {LINK_TYPE_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {LINK_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="rounded bg-blue-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-blue-500"
              >
                + Ajouter le lien
              </button>
            </form>
            {linkError && <p className="mt-2 text-xs text-red-400">{linkError}</p>}

            <ul className="mt-4 divide-y divide-neutral-800 border-t border-neutral-800">
              {links.map((l) => (
                <li key={l.id} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    <span className="font-medium text-neutral-200">{hostName(l.host_a_id)}</span>
                    <span className="text-neutral-500"> ↔ </span>
                    <span className="font-medium text-neutral-200">{hostName(l.host_b_id)}</span>
                    <span className="ml-2 text-xs text-neutral-500">
                      {LINK_TYPE_LABELS[l.link_type] ?? l.link_type}
                    </span>
                  </span>
                  <button
                    onClick={() => deleteLink(l.id)}
                    className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-red-400 hover:bg-neutral-800"
                  >
                    Supprimer
                  </button>
                </li>
              ))}
              {links.length === 0 && <li className="py-3 text-sm text-neutral-500">Aucun lien pour l&apos;instant.</li>}
            </ul>
          </div>
        </div>
      )}

      {editingId !== null && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-8">
          <form
            onSubmit={submitForm}
            className="max-h-full w-full max-w-lg space-y-3 overflow-auto rounded border border-neutral-700 bg-neutral-950 p-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                {editingId === "new" ? "Ajouter une machine" : "Modifier la machine"}
              </h2>
              <button
                type="button"
                onClick={() => setEditingId(null)}
                className="text-neutral-500 hover:text-neutral-300"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs mb-1">Nom</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-xs mb-1">Type</label>
                <select
                  value={form.kind}
                  onChange={(e) => setForm({ ...form, kind: e.target.value })}
                  className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                >
                  {KIND_OPTIONS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1">Rôle</label>
                <input
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs mb-1">OS</label>
                <input
                  value={form.os}
                  onChange={(e) => setForm({ ...form, os: e.target.value })}
                  className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs mb-1">Cluster (optionnel)</label>
                <input
                  value={form.cluster}
                  onChange={(e) => setForm({ ...form, cluster: e.target.value })}
                  className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs mb-1">
                  Nom du nœud Proxmox <span className="text-neutral-500">(si applicable)</span>
                </label>
                <input
                  value={form.proxmox_node}
                  onChange={(e) => setForm({ ...form, proxmox_node: e.target.value })}
                  placeholder="ex: pve1"
                  className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm font-mono"
                />
                <p className="mt-1 text-xs text-neutral-500">
                  Renseigne le nom exact du nœud (visible dans Proxmox) pour un calcul de
                  CPU/RAM/stockage exact via l&apos;API Proxmox — sinon le panel utilise SSH, qui ne
                  voit pas le stockage LVM-thin/ZFS des VM.
                </p>
              </div>
              <div>
                <label className="block text-xs mb-1">IP LAN</label>
                <input
                  value={form.lan_ip}
                  onChange={(e) => setForm({ ...form, lan_ip: e.target.value })}
                  className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs mb-1">IP Tailscale</label>
                <input
                  value={form.tailscale_ip}
                  onChange={(e) => setForm({ ...form, tailscale_ip: e.target.value })}
                  className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs mb-1">IP publique</label>
                <input
                  value={form.public_ip}
                  onChange={(e) => setForm({ ...form, public_ip: e.target.value })}
                  className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs mb-1">Port SSH</label>
                <input
                  value={form.ssh_port}
                  onChange={(e) => setForm({ ...form, ssh_port: e.target.value })}
                  className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                  inputMode="numeric"
                />
              </div>
              <div>
                <label className="block text-xs mb-1">Utilisateur SSH (défaut: root)</label>
                <input
                  value={form.ssh_user}
                  onChange={(e) => setForm({ ...form, ssh_user: e.target.value })}
                  className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs mb-1">Méthode de mise à jour</label>
                <select
                  value={form.update_method}
                  onChange={(e) => setForm({ ...form, update_method: e.target.value })}
                  className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                >
                  <option value="">Aucune</option>
                  {UPDATE_METHOD_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 flex items-center gap-4 pt-1">
                <label className="flex items-center gap-2 text-xs text-neutral-400">
                  <input
                    type="checkbox"
                    checked={form.docker_enabled}
                    onChange={(e) => setForm({ ...form, docker_enabled: e.target.checked })}
                  />
                  Docker sur cette machine
                </label>
                <label className="flex items-center gap-2 text-xs text-neutral-400">
                  <input
                    type="checkbox"
                    checked={form.needs_sudo}
                    onChange={(e) => setForm({ ...form, needs_sudo: e.target.checked })}
                  />
                  Nécessite sudo -i
                </label>
              </div>
              <div className="col-span-2">
                <label className="block text-xs mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                />
              </div>
            </div>

            {formError && <p className="text-xs text-red-400">{formError}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingId(null)}
                className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="rounded bg-blue-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-blue-500"
              >
                {editingId === "new" ? "Créer" : "Enregistrer"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
