"use client";

import { useCallback, useEffect, useState } from "react";

type Device = {
  id: string;
  hostname: string;
  name: string;
  addresses: string[];
  os: string;
  authorized: boolean;
  online: boolean;
  lastSeen: string;
  clientVersion: string;
};

export default function TailscalePage() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [tailnet, setTailnet] = useState("");
  const [routesFor, setRoutesFor] = useState<string | null>(null);
  const [routes, setRoutes] = useState<{ advertisedRoutes: string[]; enabledRoutes: string[] } | null>(null);
  const [showAcl, setShowAcl] = useState(false);
  const [aclPolicy, setAclPolicy] = useState("");
  const [aclLoading, setAclLoading] = useState(false);
  const [aclMessage, setAclMessage] = useState("");

  const loadConfig = useCallback(async () => {
    const res = await fetch("/api/tailscale/config");
    const data = await res.json();
    setConfigured(data.configured);
    if (data.tailnet) setTailnet(data.tailnet);
    return data.configured as boolean;
  }, []);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/tailscale/devices");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDevices(data.devices);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig().then((isConfigured) => {
      if (isConfigured) loadDevices();
    });
  }, [loadConfig, loadDevices]);

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const res = await fetch("/api/tailscale/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, tailnet }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setApiKey("");
      setShowConfig(false);
      setConfigured(true);
      loadDevices();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function toggleAuthorized(device: Device) {
    await fetch(`/api/tailscale/devices/${device.id}/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authorized: !device.authorized }),
    });
    loadDevices();
  }

  async function removeDevice(device: Device) {
    if (!confirm(`Retirer ${device.name} du tailnet ?`)) return;
    await fetch(`/api/tailscale/devices/${device.id}`, { method: "DELETE" });
    loadDevices();
  }

  async function toggleRoutes(device: Device) {
    if (routesFor === device.id) {
      setRoutesFor(null);
      return;
    }
    setRoutesFor(device.id);
    const res = await fetch(`/api/tailscale/devices/${device.id}/routes`);
    const data = await res.json();
    setRoutes(data);
  }

  async function setRouteEnabled(device: Device, route: string, enabled: boolean) {
    if (!routes) return;
    const nextEnabled = enabled
      ? [...routes.enabledRoutes, route]
      : routes.enabledRoutes.filter((r) => r !== route);
    setRoutes({ ...routes, enabledRoutes: nextEnabled });
    await fetch(`/api/tailscale/devices/${device.id}/routes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabledRoutes: nextEnabled }),
    });
  }

  async function loadAcl() {
    setShowAcl((s) => !s);
    if (!aclPolicy) {
      setAclLoading(true);
      try {
        const res = await fetch("/api/tailscale/acl");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setAclPolicy(data.policy);
      } catch (err) {
        setAclMessage(err instanceof Error ? err.message : "Erreur.");
      } finally {
        setAclLoading(false);
      }
    }
  }

  async function saveAcl() {
    setAclLoading(true);
    setAclMessage("");
    try {
      const res = await fetch("/api/tailscale/acl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy: aclPolicy }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAclMessage("Politique ACL enregistrée.");
    } catch (err) {
      setAclMessage(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setAclLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tailscale</h1>
          <p className="text-sm text-neutral-400">
            {devices.length > 0 ? `${devices.length} appareils dans le tailnet.` : "Devices du tailnet."}
          </p>
        </div>
        <button
          onClick={() => setShowConfig((s) => !s)}
          className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
        >
          {configured ? "Reconfigurer" : "Configurer"}
        </button>
      </div>

      {showConfig && (
        <form onSubmit={saveConfig} className="max-w-md space-y-3 rounded border border-neutral-800 p-4">
          <p className="text-xs text-neutral-400">
            Génère une clé API dans la console Tailscale (Settings → Keys → Generate API key).
          </p>
          <div>
            <label className="block text-xs mb-1">Tailnet (ex: tonnom.ts.net)</label>
            <input
              value={tailnet}
              onChange={(e) => setTailnet(e.target.value)}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-xs mb-1">Clé API</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              required
            />
          </div>
          <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500">
            Enregistrer
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-neutral-500">Chargement...</p>}

      {devices.length > 0 && (
        <div className="overflow-auto rounded border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-left text-neutral-400">
              <tr>
                <th className="px-3 py-2 font-medium">Nom</th>
                <th className="px-3 py-2 font-medium">IP Tailscale</th>
                <th className="px-3 py-2 font-medium">OS</th>
                <th className="px-3 py-2 font-medium">Statut</th>
                <th className="px-3 py-2 font-medium">Autorisé</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id} className="border-t border-neutral-800">
                  <td className="px-3 py-2 font-medium">{d.name || d.hostname}</td>
                  <td className="px-3 py-2 font-mono text-xs">{d.addresses?.[0] ?? "—"}</td>
                  <td className="px-3 py-2 text-neutral-400">{d.os}</td>
                  <td className="px-3 py-2">
                    <span className={d.online ? "text-green-400" : "text-neutral-500"}>
                      {d.online ? "🟢 en ligne" : "⚪ hors ligne"}
                    </span>
                  </td>
                  <td className="px-3 py-2">{d.authorized ? "✅" : "❌"}</td>
                  <td className="px-3 py-2 space-x-2">
                    <button
                      onClick={() => toggleAuthorized(d)}
                      className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800"
                    >
                      {d.authorized ? "Révoquer" : "Autoriser"}
                    </button>
                    <button
                      onClick={() => toggleRoutes(d)}
                      className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800"
                    >
                      Routes
                    </button>
                    <button
                      onClick={() => removeDevice(d)}
                      className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-red-400 hover:bg-neutral-800"
                    >
                      Retirer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {routesFor && routes && (
        <div className="max-w-xl rounded border border-neutral-800 p-4">
          <h2 className="mb-2 text-sm font-semibold text-neutral-100">
            Routes annoncées par {devices.find((d) => d.id === routesFor)?.name}
          </h2>
          {routes.advertisedRoutes.length === 0 && (
            <p className="text-xs text-neutral-500">Cet appareil n&apos;annonce aucune route de sous-réseau.</p>
          )}
          <ul className="space-y-1">
            {routes.advertisedRoutes.map((route) => {
              const device = devices.find((d) => d.id === routesFor)!;
              const enabled = routes.enabledRoutes.includes(route);
              return (
                <li key={route} className="flex items-center justify-between rounded border border-neutral-800 px-2 py-1 text-sm">
                  <span className="font-mono text-neutral-300">{route}</span>
                  <label className="flex items-center gap-2 text-xs text-neutral-400">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => setRouteEnabled(device, route, e.target.checked)}
                    />
                    Approuvée
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {configured && (
        <div className="rounded border border-neutral-800">
          <button onClick={loadAcl} className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-neutral-300">
            <span>Politique ACL du tailnet</span>
            <span className="text-neutral-500">{showAcl ? "▲" : "▼"}</span>
          </button>
          {showAcl && (
            <div className="space-y-2 border-t border-neutral-800 p-4">
              <p className="text-xs text-neutral-500">
                Définit qui peut parler à qui sur le tailnet (tags, règles d&apos;accès, auto-approbation de routes...).
                Format HuJSON — attention, une erreur ici peut couper l&apos;accès entre tes machines.
              </p>
              {aclLoading && <p className="text-xs text-neutral-500">Chargement...</p>}
              <textarea
                value={aclPolicy}
                onChange={(e) => setAclPolicy(e.target.value)}
                rows={16}
                spellCheck={false}
                className="w-full rounded border border-neutral-800 bg-black p-3 font-mono text-xs text-neutral-200"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={saveAcl}
                  disabled={aclLoading}
                  className="rounded border border-amber-700 bg-amber-900/40 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-900/60 disabled:opacity-50"
                >
                  Enregistrer la politique ACL
                </button>
                {aclMessage && <span className="text-xs text-neutral-400">{aclMessage}</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
