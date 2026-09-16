"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";

const Terminal = dynamic(() => import("@/components/Terminal"), { ssr: false });

type Host = {
  id: number;
  name: string;
  kind: string;
  lan_ip: string | null;
  tailscale_ip: string | null;
  public_ip: string | null;
  needs_sudo: number;
};
type Credential = { id: number; kind: string; label: string | null; created_at: string };

// A unified, selectable SSH target — a real inventory host, or an ephemeral Docker
// container/Proxmox LXC discovered live (no inventory entry needed for those, same as the
// per-card Terminal buttons on the Docker/Proxmox pages).
type SshTarget = {
  key: string;
  label: string;
  sublabel: string;
  hostId: number;
  containerId?: string;
  execKind?: "docker" | "pct";
};

export default function SshPage() {
  return (
    <Suspense fallback={null}>
      <SshPageInner />
    </Suspense>
  );
}

function SshPageInner() {
  const searchParams = useSearchParams();
  const [hosts, setHosts] = useState<Host[]>([]);
  const [dockerTargets, setDockerTargets] = useState<SshTarget[]>([]);
  const [lxcTargets, setLxcTargets] = useState<SshTarget[]>([]);
  // Every target a terminal has been opened for stays mounted (just hidden, never unmounted) once
  // opened, so switching the active tab — or, on mobile, closing the modal — never tears down its
  // WebSocket. Only the explicit "✕ close" on a tab actually disconnects it.
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [statusByKey, setStatusByKey] = useState<Record<string, string>>({});
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [showCredForm, setShowCredForm] = useState(false);
  const [credKind, setCredKind] = useState<"ssh_key" | "ssh_password" | "sudo_password">("ssh_password");
  const [credLabel, setCredLabel] = useState("");
  const [credSecret, setCredSecret] = useState("");
  const [credError, setCredError] = useState("");

  const hostTargets: SshTarget[] = hosts.map((h) => ({
    key: `host:${h.id}`,
    label: h.name,
    sublabel: h.tailscale_ip || h.lan_ip || h.public_ip || "pas d'IP",
    hostId: h.id,
  }));
  const allTargets = [...hostTargets, ...dockerTargets, ...lxcTargets];
  const activeTarget = allTargets.find((t) => t.key === activeKey) ?? null;
  // The sudo/credentials management panel only makes sense for a real inventory host — an ad-hoc
  // Docker container or LXC has no SSH credentials of its own, it rides on its host's.
  const selectedHost = activeTarget && !activeTarget.containerId ? hosts.find((h) => h.id === activeTarget.hostId) ?? null : null;

  function openTarget(key: string) {
    setOpenKeys((keys) => (keys.includes(key) ? keys : [...keys, key]));
    setActiveKey(key);
    setModalOpen(true);
  }

  function closeTarget(key: string) {
    setOpenKeys((keys) => {
      const next = keys.filter((k) => k !== key);
      setActiveKey((current) => {
        if (current !== key) return current;
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
        if (preselect && d.hosts.some((h: Host) => h.id === preselect)) openTarget(`host:${preselect}`);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetch("/api/docker/containers")
      .then((r) => r.json())
      .then((d) => {
        type AggregatedContainer = { id: string; name: string; state: string; hostId: number; hostName: string };
        const running = (d.containers as AggregatedContainer[]).filter((c) => c.state === "running");
        setDockerTargets(
          running.map((c) => ({
            key: `docker:${c.hostId}:${c.id}`,
            label: c.name,
            sublabel: `Docker — ${c.hostName}`,
            hostId: c.hostId,
            containerId: c.id,
            execKind: "docker" as const,
          }))
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const hostsRes = await fetch("/api/hosts");
        const hostsData = await hostsRes.json();
        const physical: { id: number; kind: string }[] = hostsData.hosts.filter((h: Host) => h.kind === "physical");
        const targets: SshTarget[] = [];
        for (const h of physical) {
          const configRes = await fetch(`/api/proxmox/${h.id}/config`);
          const config = await configRes.json();
          if (!config.configured) continue;
          const resRes = await fetch(`/api/proxmox/${h.id}/resources`);
          if (!resRes.ok) continue;
          const resData = await resRes.json();
          type Resource = { vmid: number; node: string; type: "qemu" | "lxc"; name: string; status: string };
          for (const r of resData.resources as Resource[]) {
            if (r.type === "lxc" && r.status === "running") {
              targets.push({
                key: `pct:${h.id}:${r.vmid}`,
                label: r.name || `#${r.vmid}`,
                sublabel: `LXC — ${r.node}`,
                hostId: h.id,
                containerId: String(r.vmid),
                execKind: "pct",
              });
            }
          }
        }
        setLxcTargets(targets);
      } catch {
        // best-effort — the host-based terminal list above always works regardless
      }
    })();
  }, []);

  async function toggleNeedsSudo() {
    if (!selectedHost) return;
    const next = selectedHost.needs_sudo ? 0 : 1;
    await fetch(`/api/hosts/${selectedHost.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ needs_sudo: next }),
    });
    setHosts((hs) => hs.map((h) => (h.id === selectedHost.id ? { ...h, needs_sudo: next } : h)));
  }

  const loadCredentials = useCallback(async (hostId: number) => {
    const res = await fetch(`/api/hosts/${hostId}/credentials`);
    const data = await res.json();
    setCredentials(data.credentials);
  }, []);

  useEffect(() => {
    if (selectedHost) loadCredentials(selectedHost.id);
  }, [selectedHost, loadCredentials]);

  // A fresh arrow function on every render would change identity and re-trigger Terminal's
  // connection effect (see its `onStatusChange` dependency) — memoizing one stable callback per
  // target, reused across renders, keeps switching tabs from looking like a reconnect.
  const statusHandlers = useRef<Map<string, (status: string, message?: string) => void>>(new Map());
  function getStatusHandler(key: string) {
    let handler = statusHandlers.current.get(key);
    if (!handler) {
      handler = (status, message) => {
        setStatusByKey((prev) => ({ ...prev, [key]: message ? `${status}: ${message}` : status }));
      };
      statusHandlers.current.set(key, handler);
    }
    return handler;
  }

  async function addCredential(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedHost) return;
    setCredError("");
    try {
      const res = await fetch(`/api/hosts/${selectedHost.id}/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: credKind, label: credLabel, secret: credSecret }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCredSecret("");
      setCredLabel("");
      setShowCredForm(false);
      loadCredentials(selectedHost.id);
    } catch (err) {
      setCredError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function deleteCredential(credId: number) {
    if (!selectedHost) return;
    await fetch(`/api/hosts/${selectedHost.id}/credentials/${credId}`, { method: "DELETE" });
    loadCredentials(selectedHost.id);
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col gap-4 md:flex-row">
      <div className="w-full shrink-0 space-y-4 overflow-auto md:w-64">
        <div>
          <h1 className="text-lg font-semibold">Terminal SSH</h1>
          <p className="text-xs text-neutral-500">Sélectionne une machine, un conteneur Docker ou un LXC</p>
        </div>
        <TargetGroup title="Machines" targets={hostTargets} activeKey={activeKey} openKeys={openKeys} onOpen={openTarget} />
        <TargetGroup title="Conteneurs Docker" targets={dockerTargets} activeKey={activeKey} openKeys={openKeys} onOpen={openTarget} />
        <TargetGroup title="LXC Proxmox" targets={lxcTargets} activeKey={activeKey} openKeys={openKeys} onOpen={openTarget} />

        {selectedHost && (
          <div className="space-y-2 border-t border-neutral-800 pt-4">
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              <input type="checkbox" checked={!!selectedHost.needs_sudo} onChange={toggleNeedsSudo} />
              Nécessite <code className="text-neutral-300">sudo -i</code> — élève automatiquement
              le terminal en root à la connexion, et pour les commandes privilégiées (apt,
              docker...)
            </label>

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs font-medium text-neutral-400">Identifiants SSH</span>
              <button
                onClick={() => setShowCredForm((s) => !s)}
                className="text-xs text-blue-400 hover:underline"
              >
                + Ajouter
              </button>
            </div>
            {credentials.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-xs text-neutral-400">
                <span>
                  {c.kind === "ssh_key" ? "🔑" : c.kind === "sudo_password" ? "🛡️" : "🔒"}{" "}
                  {c.label || c.kind}
                </span>
                <button onClick={() => deleteCredential(c.id)} className="text-red-400 hover:underline">
                  suppr.
                </button>
              </div>
            ))}
            {showCredForm && (
              <form onSubmit={addCredential} className="space-y-2 rounded border border-neutral-800 p-2">
                <select
                  value={credKind}
                  onChange={(e) => setCredKind(e.target.value as "ssh_key" | "ssh_password" | "sudo_password")}
                  className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs"
                >
                  <option value="ssh_password">Mot de passe SSH</option>
                  <option value="ssh_key">Clé privée SSH</option>
                  <option value="sudo_password">Mot de passe sudo (si différent)</option>
                </select>
                {credKind === "sudo_password" && (
                  <p className="text-xs text-neutral-500">
                    Par défaut, le mot de passe SSH est réutilisé pour sudo. N&apos;ajoute ceci
                    que s&apos;il est différent.
                  </p>
                )}
                <input
                  placeholder="Libellé (optionnel, ex: clé principale)"
                  value={credLabel}
                  onChange={(e) => setCredLabel(e.target.value)}
                  className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs"
                />
                <textarea
                  placeholder={credKind === "ssh_key" ? "-----BEGIN OPENSSH PRIVATE KEY-----..." : "mot de passe"}
                  value={credSecret}
                  onChange={(e) => setCredSecret(e.target.value)}
                  required
                  rows={credKind === "ssh_key" ? 4 : 1}
                  className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs font-mono"
                />
                {credError && <p className="text-xs text-red-400">{credError}</p>}
                <button
                  type="submit"
                  className="w-full rounded bg-blue-600 text-white py-1 text-xs font-medium hover:bg-blue-500"
                >
                  Enregistrer (chiffré)
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      {/* On mobile this panel is a fullscreen modal, only shown when a terminal was opened —
          closing it (✕ or backdrop) just hides it, it never tears down the connection underneath.
          On desktop (md+) it's always the visible right-hand column, whatever modalOpen is. */}
      <div
        className={`flex-1 flex-col ${
          modalOpen
            ? "fixed inset-0 z-50 bg-black/90 p-3 md:static md:z-auto md:bg-transparent md:p-0"
            : "hidden"
        } md:flex`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setModalOpen(false);
        }}
      >
        {activeKey ? (
          <div className="flex h-full flex-col rounded border border-neutral-800 bg-black p-2">
            <div className="mb-2 flex items-center gap-1 overflow-x-auto">
              {openKeys.map((key) => {
                const t = allTargets.find((tt) => tt.key === key);
                return (
                  <div
                    key={key}
                    className={`flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-xs ${
                      key === activeKey ? "bg-blue-600/20 text-blue-300" : "bg-neutral-900 text-neutral-400"
                    }`}
                  >
                    <button onClick={() => openTarget(key)}>{t?.label ?? key}</button>
                    <button
                      onClick={() => closeTarget(key)}
                      aria-label={`Fermer la connexion à ${t?.label ?? key}`}
                      className="text-neutral-500 hover:text-red-400"
                    >
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
              {openKeys.map((key) => {
                const t = allTargets.find((tt) => tt.key === key);
                if (!t) return null;
                return (
                  <div key={key} className={key === activeKey ? "absolute inset-0" : "hidden"}>
                    <Terminal
                      hostId={t.hostId}
                      containerId={t.containerId}
                      execKind={t.execKind}
                      onStatusChange={getStatusHandler(key)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="hidden h-full items-center justify-center text-sm text-neutral-500 md:flex">
            Sélectionne une machine, un conteneur ou un LXC pour ouvrir un terminal.
          </div>
        )}
      </div>

      {activeKey !== null && statusByKey[activeKey] && (
        <div
          className={`${
            modalOpen ? "" : "hidden md:block"
          } fixed bottom-4 right-4 z-[60] rounded bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300 shadow`}
        >
          {statusByKey[activeKey]}
        </div>
      )}
    </div>
  );
}

function TargetGroup({
  title,
  targets,
  activeKey,
  openKeys,
  onOpen,
}: {
  title: string;
  targets: SshTarget[];
  activeKey: string | null;
  openKeys: string[];
  onOpen: (key: string) => void;
}) {
  if (targets.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-neutral-600">{title}</p>
      {targets.map((t) => (
        <button
          key={t.key}
          onClick={() => onOpen(t.key)}
          className={`block w-full rounded px-3 py-2 text-left text-sm ${
            activeKey === t.key
              ? "bg-blue-600/20 text-blue-300"
              : openKeys.includes(t.key)
                ? "bg-neutral-900 text-neutral-200"
                : "text-neutral-400 hover:bg-neutral-900"
          }`}
        >
          {t.label}
          {openKeys.includes(t.key) && <span className="ml-1.5 text-emerald-400">●</span>}
          <div className="text-xs text-neutral-500">{t.sublabel}</div>
        </button>
      ))}
    </div>
  );
}
