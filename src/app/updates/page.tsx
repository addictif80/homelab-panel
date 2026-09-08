"use client";

import { useEffect, useRef, useState } from "react";

type Host = {
  id: number;
  name: string;
  kind: string;
  update_method: string | null;
};

type HostState = {
  log: string[];
  status: "idle" | "running" | "done" | "error";
};

const METHOD_LABELS: Record<string, string> = {
  apt: "apt (Debian/Ubuntu)",
  opkg: "opkg (OpenWrt)",
  dsm: "DSM (Synology)",
};

async function streamUpdate(
  hostId: number,
  mode: "dry-run" | "apply",
  allowAutoReboot: boolean,
  onLine: (line: string) => void
): Promise<void> {
  const res = await fetch(`/api/updates/${hostId}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, allowAutoReboot }),
  });
  if (!res.body) throw new Error("Flux indisponible.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const lines = chunk.split("\n");
      const eventLine = lines.find((l) => l.startsWith("event: "));
      const dataLine = lines.find((l) => l.startsWith("data: "));
      const event = eventLine?.slice(7) ?? "message";
      const data = dataLine?.slice(6) ?? "";
      if (event === "error") throw new Error(data);
      if (event === "done") return;
      onLine(data);
    }
  }
}

export default function UpdatesPage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [states, setStates] = useState<Record<number, HostState>>({});
  const [allowAutoReboot, setAllowAutoReboot] = useState(true);
  const [runningAll, setRunningAll] = useState(false);
  const logRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    fetch("/api/hosts")
      .then((r) => r.json())
      .then((d) => setHosts(d.hosts.filter((h: Host) => h.update_method)));
  }, []);

  function appendLine(hostId: number, line: string) {
    setStates((s) => ({
      ...s,
      [hostId]: { ...s[hostId], log: [...(s[hostId]?.log ?? []), line], status: "running" },
    }));
    requestAnimationFrame(() => {
      const el = logRefs.current[hostId];
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  async function runHost(hostId: number, mode: "dry-run" | "apply") {
    setStates((s) => ({ ...s, [hostId]: { log: [], status: "running" } }));
    try {
      await streamUpdate(hostId, mode, allowAutoReboot, (line) => appendLine(hostId, line));
      setStates((s) => ({ ...s, [hostId]: { log: s[hostId]?.log ?? [], status: "done" } }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur inconnue";
      setStates((s) => ({
        ...s,
        [hostId]: { log: [...(s[hostId]?.log ?? []), `Erreur: ${message}`], status: "error" },
      }));
    }
  }

  async function runAll(mode: "dry-run" | "apply") {
    setRunningAll(true);
    for (const h of hosts) {
      await runHost(h.id, mode);
    }
    setRunningAll(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Mises à jour</h1>
          <p className="text-sm text-neutral-400">
            {hosts.length} machine{hosts.length > 1 ? "s" : ""} avec une méthode de mise à jour
            configurée.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-neutral-400">
            <input
              type="checkbox"
              checked={allowAutoReboot}
              onChange={(e) => setAllowAutoReboot(e.target.checked)}
            />
            Redémarrer automatiquement si nécessaire (jamais sur le routeur)
          </label>
          <button
            onClick={() => runAll("dry-run")}
            disabled={runningAll}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800 disabled:opacity-50"
          >
            Preview (dry-run) — tout
          </button>
          <button
            onClick={() => runAll("apply")}
            disabled={runningAll}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            Tout mettre à jour
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {hosts.map((h) => {
          const state = states[h.id];
          return (
            <div key={h.id} className="rounded border border-neutral-800">
              <div className="flex items-center justify-between px-4 py-2">
                <div>
                  <span className="font-medium text-sm">{h.name}</span>
                  <span className="ml-2 text-xs text-neutral-500">
                    {METHOD_LABELS[h.update_method ?? ""] ?? h.update_method}
                  </span>
                  {state?.status === "running" && (
                    <span className="ml-2 text-xs text-blue-400">en cours...</span>
                  )}
                  {state?.status === "done" && (
                    <span className="ml-2 text-xs text-green-400">terminé</span>
                  )}
                  {state?.status === "error" && (
                    <span className="ml-2 text-xs text-red-400">erreur</span>
                  )}
                </div>
                <div className="space-x-2">
                  <button
                    onClick={() => runHost(h.id, "dry-run")}
                    disabled={state?.status === "running"}
                    className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800 disabled:opacity-50"
                  >
                    Preview
                  </button>
                  <button
                    onClick={() => runHost(h.id, "apply")}
                    disabled={state?.status === "running"}
                    className="rounded bg-blue-600 px-2 py-1 text-xs font-medium hover:bg-blue-500 disabled:opacity-50"
                  >
                    Mettre à jour
                  </button>
                </div>
              </div>
              {state && state.log.length > 0 && (
                <div
                  ref={(el) => {
                    logRefs.current[h.id] = el;
                  }}
                  className="max-h-64 overflow-auto border-t border-neutral-800 bg-black p-3 font-mono text-xs text-neutral-300"
                >
                  {state.log.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
