"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
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
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sessionKey, setSessionKey] = useState(0);
  const [status, setStatus] = useState<string>("");
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [showCredForm, setShowCredForm] = useState(false);
  const [credKind, setCredKind] = useState<"ssh_key" | "ssh_password" | "sudo_password">("ssh_password");
  const [credLabel, setCredLabel] = useState("");
  const [credSecret, setCredSecret] = useState("");
  const [credError, setCredError] = useState("");

  const selectedHost = hosts.find((h) => h.id === selectedId) ?? null;

  useEffect(() => {
    fetch("/api/hosts")
      .then((r) => r.json())
      .then((d) => {
        setHosts(d.hosts);
        const preselect = Number(searchParams.get("hostId"));
        if (preselect && d.hosts.some((h: Host) => h.id === preselect)) {
          setSelectedId(preselect);
          setSessionKey((k) => k + 1);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (selectedId) loadCredentials(selectedId);
  }, [selectedId, loadCredentials]);

  const handleStatusChange = useCallback((s: string, message?: string) => {
    setStatus(message ? `${s}: ${message}` : s);
  }, []);

  async function addCredential(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    setCredError("");
    try {
      const res = await fetch(`/api/hosts/${selectedId}/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: credKind, label: credLabel, secret: credSecret }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCredSecret("");
      setCredLabel("");
      setShowCredForm(false);
      loadCredentials(selectedId);
    } catch (err) {
      setCredError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function deleteCredential(credId: number) {
    if (!selectedId) return;
    await fetch(`/api/hosts/${selectedId}/credentials/${credId}`, { method: "DELETE" });
    loadCredentials(selectedId);
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] gap-4">
      <div className="w-64 shrink-0 space-y-4 overflow-auto">
        <div>
          <h1 className="text-lg font-semibold">Terminal SSH</h1>
          <p className="text-xs text-neutral-500">Sélectionne une machine</p>
        </div>
        <div className="space-y-1">
          {hosts.map((h) => (
            <button
              key={h.id}
              onClick={() => {
                setSelectedId(h.id);
                setSessionKey((k) => k + 1);
                setStatus("");
              }}
              className={`block w-full rounded px-3 py-2 text-left text-sm ${
                selectedId === h.id
                  ? "bg-blue-600/20 text-blue-300"
                  : "text-neutral-400 hover:bg-neutral-900"
              }`}
            >
              {h.name}
              <div className="text-xs text-neutral-500">
                {h.tailscale_ip || h.lan_ip || h.public_ip || "pas d'IP"}
              </div>
            </button>
          ))}
        </div>

        {selectedHost && (
          <div className="space-y-2 border-t border-neutral-800 pt-4">
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              <input type="checkbox" checked={!!selectedHost.needs_sudo} onChange={toggleNeedsSudo} />
              Nécessite <code className="text-neutral-300">sudo -i</code> pour les commandes
              privilégiées (apt, docker...)
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
                  className="w-full rounded bg-blue-600 py-1 text-xs font-medium hover:bg-blue-500"
                >
                  Enregistrer (chiffré)
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 rounded border border-neutral-800 bg-black p-2">
        {selectedId ? (
          <Terminal key={sessionKey} hostId={selectedId} onStatusChange={handleStatusChange} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-neutral-500">
            Sélectionne une machine pour ouvrir un terminal.
          </div>
        )}
      </div>

      {status && (
        <div className="fixed bottom-4 right-4 rounded bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300 shadow">
          {status}
        </div>
      )}
    </div>
  );
}
