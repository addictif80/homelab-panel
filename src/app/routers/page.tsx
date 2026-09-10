"use client";

import { useCallback, useEffect, useState } from "react";

type Host = { id: number; name: string; lan_ip: string | null; router_provider: string | null };
type ProviderField = { key: string; label: string; placeholder?: string; secret?: boolean };
type ProviderMeta = {
  id: string;
  name: string;
  helpText: string;
  needsConfig: boolean;
  configFields: ProviderField[];
  secretFields: ProviderField[];
};
type RouterStatus = { model: string | null; uptimeSeconds: number | null; wanIp: string | null; connectedDevicesCount: number | null };
type Device = { id: string; hostname: string | null; ip: string; mac: string; wifi: boolean };
type PortForward = {
  id: string;
  protocol: string;
  externalPort: string;
  internalIp: string;
  internalPort: string;
  description?: string;
  enabled: boolean;
};
type WifiNetwork = { id: string; band: string; ssid: string; enabled: boolean };

const EMPTY_PF = { protocol: "tcp", externalPort: "", internalIp: "", internalPort: "", description: "" };

export default function RoutersPage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [providers, setProviders] = useState<ProviderMeta[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const [showConfig, setShowConfig] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [secret, setSecret] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [pairingStatus, setPairingStatus] = useState<string | null>(null);

  const [status, setStatus] = useState<RouterStatus | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [forwards, setForwards] = useState<PortForward[] | null>(null);
  const [wifiNetworks, setWifiNetworks] = useState<WifiNetwork[] | null>(null);
  const [loadingPanel, setLoadingPanel] = useState(false);

  const [showAddForward, setShowAddForward] = useState(false);
  const [newForward, setNewForward] = useState(EMPTY_PF);

  const loadHosts = useCallback(async () => {
    const res = await fetch("/api/hosts");
    const data = await res.json();
    const routers: Host[] = data.hosts.filter((h: { kind: string }) => h.kind === "router");
    setHosts(routers);
    if (routers.length > 0 && activeId === null) setActiveId(routers[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadHosts();
  }, [loadHosts]);

  const activeHost = hosts.find((h) => h.id === activeId) ?? null;

  const loadConfig = useCallback(async (hostId: number) => {
    const res = await fetch(`/api/routers/${hostId}/config`);
    const data = await res.json();
    setProviders(data.providers);
    setSelectedProvider(data.provider || "");
    setConfig(data.config || {});
    setSecret({});
  }, []);

  const loadPanel = useCallback(async (hostId: number) => {
    setLoadingPanel(true);
    setError("");
    setStatus(null);
    setDevices(null);
    setForwards(null);
    setWifiNetworks(null);
    try {
      const [statusRes, devicesRes, forwardsRes, wifiRes] = await Promise.all([
        fetch(`/api/routers/${hostId}/status`),
        fetch(`/api/routers/${hostId}/devices`),
        fetch(`/api/routers/${hostId}/port-forwards`),
        fetch(`/api/routers/${hostId}/wifi`),
      ]);
      const [statusData, devicesData, forwardsData, wifiData] = await Promise.all([
        statusRes.json(),
        devicesRes.json(),
        forwardsRes.json(),
        wifiRes.json(),
      ]);
      if (statusRes.ok) setStatus(statusData.status);
      else setError(statusData.error);
      if (devicesRes.ok) setDevices(devicesData.devices);
      if (forwardsRes.ok) setForwards(forwardsData.forwards);
      if (wifiRes.ok) setWifiNetworks(wifiData.networks);
    } finally {
      setLoadingPanel(false);
    }
  }, []);

  useEffect(() => {
    if (!activeId || !activeHost) return;
    loadConfig(activeId);
    if (activeHost.router_provider) loadPanel(activeId);
  }, [activeId, activeHost, loadConfig, loadPanel]);

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!activeId) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/routers/${activeId}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: selectedProvider || null, config, secret }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowConfig(false);
      loadHosts();
      loadPanel(activeId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  async function pairFreebox() {
    if (!activeId) return;
    setPairingStatus("pending");
    setError("");
    try {
      const res = await fetch(`/api/routers/${activeId}/freebox/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: config.baseUrl || "https://mafreebox.freebox.fr" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const poll = async () => {
        const pollRes = await fetch(`/api/routers/${activeId}/freebox/pair/${data.sessionId}`);
        const pollData = await pollRes.json();
        if (!pollRes.ok) {
          setError(pollData.error);
          setPairingStatus(null);
          return;
        }
        setPairingStatus(pollData.status);
        if (pollData.status === "pending") setTimeout(poll, 2000);
        else if (pollData.status === "granted") {
          setShowConfig(false);
          loadHosts();
          if (activeId) loadPanel(activeId);
        }
      };
      poll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
      setPairingStatus(null);
    }
  }

  async function addForward(e: React.FormEvent) {
    e.preventDefault();
    if (!activeId) return;
    setError("");
    try {
      const res = await fetch(`/api/routers/${activeId}/port-forwards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newForward, enabled: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowAddForward(false);
      setNewForward(EMPTY_PF);
      loadPanel(activeId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function deleteForward(id: string) {
    if (!activeId || !confirm("Supprimer cette redirection de port ?")) return;
    await fetch(`/api/routers/${activeId}/port-forwards/${id}`, { method: "DELETE" });
    loadPanel(activeId);
  }

  async function toggleWifi(net: WifiNetwork) {
    if (!activeId) return;
    await fetch(`/api/routers/${activeId}/wifi/${net.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !net.enabled }),
    });
    loadPanel(activeId);
  }

  async function reboot() {
    if (!activeId || !confirm(`Redémarrer ${activeHost?.name} ?`)) return;
    await fetch(`/api/routers/${activeId}/reboot`, { method: "POST" });
  }

  const providerMeta = providers.find((p) => p.id === selectedProvider);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Box & routeurs</h1>
        <p className="text-sm text-neutral-400">
          Gère tes box (Freebox), pare-feu (pfSense) et routeurs (OpenWrt) directement depuis le panel.
        </p>
      </div>

      {hosts.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Aucune machine de type "Réseau" dans l&apos;inventaire — ajoutes-en une depuis{" "}
          <a href="/inventory" className="text-blue-400 hover:underline">
            l&apos;inventaire
          </a>
          .
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {hosts.map((h) => (
              <button
                key={h.id}
                onClick={() => setActiveId(h.id)}
                className={`rounded border px-3 py-1 text-sm ${
                  activeId === h.id
                    ? "border-blue-600 bg-blue-900/30 text-blue-200"
                    : "border-neutral-700 text-neutral-400 hover:bg-neutral-800"
                }`}
              >
                {h.name}
              </button>
            ))}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          {activeHost && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-neutral-500">
                {activeHost.router_provider
                  ? `Fournisseur : ${providers.find((p) => p.id === activeHost.router_provider)?.name ?? activeHost.router_provider}`
                  : "Aucun fournisseur configuré."}
              </p>
              <div className="flex gap-2">
                {!activeHost.router_provider && activeHost.lan_ip && (
                  <a
                    href={`http://${activeHost.lan_ip}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-800"
                  >
                    Ouvrir l&apos;interface de gestion ({activeHost.lan_ip})
                  </a>
                )}
                <button
                  onClick={() => setShowConfig((s) => !s)}
                  className="rounded border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-800"
                >
                  Configurer
                </button>
              </div>
            </div>
          )}

          {showConfig && (
            <form onSubmit={saveConfig} className="max-w-md space-y-3 rounded border border-neutral-800 p-4">
              <div>
                <label className="mb-1 block text-xs text-neutral-400">Fournisseur</label>
                <select
                  value={selectedProvider}
                  onChange={(e) => {
                    setSelectedProvider(e.target.value);
                    setConfig({});
                    setSecret({});
                  }}
                  className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                >
                  <option value="">Aucun (lien vers l&apos;interface de gestion)</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              {providerMeta && <p className="text-xs text-neutral-400">{providerMeta.helpText}</p>}
              {providerMeta?.configFields.map((f) => (
                <div key={f.key}>
                  <label className="mb-1 block text-xs text-neutral-400">{f.label}</label>
                  <input
                    value={config[f.key] ?? ""}
                    onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                    className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                  />
                </div>
              ))}
              {providerMeta?.secretFields.map((f) => (
                <div key={f.key}>
                  <label className="mb-1 block text-xs text-neutral-400">{f.label}</label>
                  <input
                    type="password"
                    value={secret[f.key] ?? ""}
                    onChange={(e) => setSecret({ ...secret, [f.key]: e.target.value })}
                    className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                  />
                </div>
              ))}

              {selectedProvider === "freebox" ? (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={pairFreebox}
                    disabled={pairingStatus === "pending"}
                    className="rounded bg-blue-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
                  >
                    {pairingStatus === "pending" ? "En attente de validation sur la Freebox..." : "Démarrer l'appairage"}
                  </button>
                  {pairingStatus === "denied" && <p className="text-xs text-red-400">Demande refusée sur la Freebox.</p>}
                  {pairingStatus === "timeout" && <p className="text-xs text-red-400">Délai dépassé, réessaie.</p>}
                </div>
              ) : (
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded bg-blue-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
                >
                  {saving ? "Enregistrement..." : "Enregistrer"}
                </button>
              )}
            </form>
          )}

          {activeHost?.router_provider && (
            <div className="space-y-4">
              {loadingPanel ? (
                <p className="text-sm text-neutral-500">Chargement...</p>
              ) : (
                <>
                  {status && (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="rounded border border-neutral-800 p-3">
                        <div className="text-xs text-neutral-500">Modèle</div>
                        <div className="mt-1 text-sm font-medium">{status.model || "—"}</div>
                      </div>
                      <div className="rounded border border-neutral-800 p-3">
                        <div className="text-xs text-neutral-500">IP WAN</div>
                        <div className="mt-1 font-mono text-sm">{status.wanIp || "—"}</div>
                      </div>
                      <div className="rounded border border-neutral-800 p-3">
                        <div className="text-xs text-neutral-500">Appareils connectés</div>
                        <div className="mt-1 text-sm font-medium">{status.connectedDevicesCount ?? "—"}</div>
                      </div>
                      <div className="rounded border border-neutral-800 p-3 flex items-center justify-between">
                        <div>
                          <div className="text-xs text-neutral-500">Actions</div>
                        </div>
                        <button onClick={reboot} className="rounded border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40">
                          Redémarrer
                        </button>
                      </div>
                    </div>
                  )}

                  {wifiNetworks && wifiNetworks.length > 0 && (
                    <div className="rounded border border-neutral-800 p-4">
                      <h2 className="mb-2 text-sm font-medium">WiFi</h2>
                      {wifiNetworks.map((net) => (
                        <div key={net.id} className="flex items-center justify-between py-1.5">
                          <span className="text-sm">
                            {net.ssid} {net.band && <span className="text-xs text-neutral-500">({net.band})</span>}
                          </span>
                          <button
                            onClick={() => toggleWifi(net)}
                            className={`rounded border px-2 py-0.5 text-xs ${
                              net.enabled ? "border-emerald-800 text-emerald-300" : "border-neutral-700 text-neutral-500"
                            }`}
                          >
                            {net.enabled ? "Activé" : "Désactivé"}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="rounded border border-neutral-800 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h2 className="text-sm font-medium">Redirections de port</h2>
                      <button
                        onClick={() => setShowAddForward((s) => !s)}
                        className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
                      >
                        + Ajouter
                      </button>
                    </div>
                    {showAddForward && (
                      <form onSubmit={addForward} className="mb-3 grid grid-cols-2 gap-2 rounded border border-neutral-800 p-3">
                        <select
                          value={newForward.protocol}
                          onChange={(e) => setNewForward({ ...newForward, protocol: e.target.value })}
                          className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm"
                        >
                          <option value="tcp">TCP</option>
                          <option value="udp">UDP</option>
                        </select>
                        <input
                          value={newForward.externalPort}
                          onChange={(e) => setNewForward({ ...newForward, externalPort: e.target.value })}
                          placeholder="Port externe (ex: 8080)"
                          required
                          className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm"
                        />
                        <input
                          value={newForward.internalIp}
                          onChange={(e) => setNewForward({ ...newForward, internalIp: e.target.value })}
                          placeholder="IP interne"
                          required
                          className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm"
                        />
                        <input
                          value={newForward.internalPort}
                          onChange={(e) => setNewForward({ ...newForward, internalPort: e.target.value })}
                          placeholder="Port interne"
                          required
                          className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm"
                        />
                        <input
                          value={newForward.description}
                          onChange={(e) => setNewForward({ ...newForward, description: e.target.value })}
                          placeholder="Description (optionnel)"
                          className="col-span-2 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm"
                        />
                        <button type="submit" className="col-span-2 rounded bg-blue-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-blue-500">
                          Créer
                        </button>
                      </form>
                    )}
                    <div className="overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="text-left text-neutral-500">
                          <tr>
                            <th className="py-1 font-medium">Proto</th>
                            <th className="py-1 font-medium">Externe</th>
                            <th className="py-1 font-medium">Interne</th>
                            <th className="py-1 font-medium">Description</th>
                            <th className="py-1 font-medium">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {forwards?.map((f) => (
                            <tr key={f.id} className="border-t border-neutral-900">
                              <td className="py-1.5 uppercase text-xs text-neutral-400">{f.protocol}</td>
                              <td className="py-1.5 font-mono text-xs">{f.externalPort}</td>
                              <td className="py-1.5 font-mono text-xs">
                                {f.internalIp}:{f.internalPort}
                              </td>
                              <td className="py-1.5 text-neutral-400">{f.description || "—"}</td>
                              <td className="py-1.5">
                                <button
                                  onClick={() => deleteForward(f.id)}
                                  className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-red-400 hover:bg-neutral-800"
                                >
                                  Supprimer
                                </button>
                              </td>
                            </tr>
                          ))}
                          {forwards?.length === 0 && (
                            <tr>
                              <td colSpan={5} className="py-4 text-center text-neutral-600">
                                Aucune redirection.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="rounded border border-neutral-800 p-4">
                    <h2 className="mb-2 text-sm font-medium">Appareils connectés</h2>
                    <div className="overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="text-left text-neutral-500">
                          <tr>
                            <th className="py-1 font-medium">Nom</th>
                            <th className="py-1 font-medium">IP</th>
                            <th className="py-1 font-medium">MAC</th>
                            <th className="py-1 font-medium">Connexion</th>
                          </tr>
                        </thead>
                        <tbody>
                          {devices?.map((d) => (
                            <tr key={d.id} className="border-t border-neutral-900">
                              <td className="py-1.5">{d.hostname || "—"}</td>
                              <td className="py-1.5 font-mono text-xs">{d.ip}</td>
                              <td className="py-1.5 font-mono text-xs text-neutral-400">{d.mac}</td>
                              <td className="py-1.5 text-xs text-neutral-400">{d.wifi ? "WiFi" : "Filaire"}</td>
                            </tr>
                          ))}
                          {devices?.length === 0 && (
                            <tr>
                              <td colSpan={4} className="py-4 text-center text-neutral-600">
                                Aucun appareil.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
