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
    </div>
  );
}
