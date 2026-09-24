"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

const BrowserViewer = dynamic(() => import("@/components/BrowserViewer"), { ssr: false });

type ServiceLink = { id: string; name: string; url: string };
type Host = { id: number; name: string; lan_ip: string | null; tailscale_ip: string | null; public_ip: string | null };

type Tab = { id: string; url: string; title: string; status: string; statusMessage?: string };

let tabCounter = 0;

export default function BrowserPage() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [services, setServices] = useState<ServiceLink[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);

  useEffect(() => {
    fetch("/api/service-links")
      .then((r) => r.json())
      .then((d) => setServices(d.links ?? d.services ?? []))
      .catch(() => {});
    fetch("/api/hosts")
      .then((r) => r.json())
      .then((d) => setHosts(d.hosts ?? []))
      .catch(() => {});
  }, []);

  function openTab(url: string) {
    if (!url.trim()) return;
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const id = `tab-${++tabCounter}`;
    setTabs((t) => [...t, { id, url: normalized, title: normalized, status: "connecting" }]);
    setActiveTabId(id);
    setUrlInput("");
  }

  function closeTab(id: string) {
    setTabs((t) => {
      const next = t.filter((tab) => tab.id !== id);
      setActiveTabId((current) => {
        if (current !== id) return current;
        return next.length > 0 ? next[next.length - 1].id : null;
      });
      return next;
    });
  }

  function updateTab(id: string, patch: Partial<Tab>) {
    setTabs((t) => t.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)));
  }

  const hostAddresses = hosts
    .map((h) => ({ name: h.name, address: h.tailscale_ip || h.lan_ip || h.public_ip }))
    .filter((h): h is { name: string; address: string } => !!h.address);

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Navigateur intégré</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Un vrai Chromium, piloté depuis la machine qui héberge le panel et diffusé en HTTP (aucun
          WebSocket) — utile pour accéder à l&apos;interface web d&apos;un service accessible uniquement
          via Tailscale, depuis un réseau qui bloque le websocket.
        </p>
      </div>

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          openTab(urlInput);
        }}
      >
        <input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="https://100.x.x.x:port ou nom-service.ts.net"
          className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600"
        />
        <button
          type="submit"
          className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-900/60"
        >
          Ouvrir un onglet
        </button>
      </form>

      {(services.length > 0 || hostAddresses.length > 0) && tabs.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {services.map((s) => (
            <button
              key={s.id}
              onClick={() => openTab(s.url)}
              className="rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
            >
              {s.name}
            </button>
          ))}
          {hostAddresses.map((h) => (
            <button
              key={h.name}
              onClick={() => openTab(`https://${h.address}`)}
              className="rounded border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
              title={h.address}
            >
              {h.name}
            </button>
          ))}
        </div>
      )}

      {tabs.length > 0 && (
        <div className="flex flex-1 flex-col overflow-hidden rounded border border-neutral-800">
          <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-neutral-800 bg-neutral-900 px-1.5 py-1">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                className={`flex max-w-[200px] shrink-0 cursor-pointer items-center gap-1.5 rounded px-2.5 py-1 text-xs ${
                  tab.id === activeTabId ? "bg-neutral-800 text-neutral-100" : "text-neutral-500 hover:bg-neutral-800/50"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    tab.status === "error" ? "bg-red-500" : tab.status === "connected" ? "bg-emerald-500" : "bg-neutral-600"
                  }`}
                />
                <span className="truncate">{tab.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className="shrink-0 text-neutral-600 hover:text-neutral-200"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="relative flex-1">
            {tabs.map((tab) => (
              <div key={tab.id} className={tab.id === activeTabId ? "absolute inset-0" : "hidden"}>
                <BrowserViewer
                  initialUrl={tab.url}
                  onStatusChange={(status, message) => updateTab(tab.id, { status, statusMessage: message })}
                  onTitleChange={(title) => updateTab(tab.id, { title })}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {tabs.length === 0 && (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-neutral-800 text-sm text-neutral-600">
          Aucun onglet ouvert — colle une adresse ci-dessus.
        </div>
      )}
    </div>
  );
}
