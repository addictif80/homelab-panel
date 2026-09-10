"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Host = { id: number; name: string; kind: string; lan_ip: string | null };
type Device = { ip: string; mac: string | null; known: boolean };

export default function DiscoveryPage() {
  const router = useRouter();
  const [hosts, setHosts] = useState<Host[]>([]);
  const [scannerId, setScannerId] = useState<number | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");

  const loadHosts = useCallback(async () => {
    const res = await fetch("/api/hosts");
    const data = await res.json();
    const withLan: Host[] = data.hosts.filter((h: Host) => h.lan_ip);
    setHosts(withLan);
    if (withLan.length > 0 && scannerId === null) setScannerId(withLan[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadHosts();
  }, [loadHosts]);

  async function runScan() {
    if (!scannerId) return;
    setScanning(true);
    setError("");
    setDevices(null);
    try {
      const res = await fetch("/api/discovery/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostId: scannerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDevices(data.devices);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setScanning(false);
    }
  }

  function addToInventory(d: Device) {
    sessionStorage.setItem(
      "discoveryPrefillHost",
      JSON.stringify({ name: d.mac ? `Appareil ${d.ip}` : d.ip, lan_ip: d.ip })
    );
    router.push("/inventory");
  }

  const unknown = devices?.filter((d) => !d.known) ?? [];
  const known = devices?.filter((d) => d.known) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Découverte réseau</h1>
        <p className="text-sm text-neutral-400">
          Balaye le réseau local vu depuis une machine de l&apos;inventaire (ping sweep + table ARP) pour repérer
          des appareils qui n&apos;y sont pas encore.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded border border-neutral-800 p-4">
        <label className="text-sm text-neutral-400">Scanner depuis</label>
        <select
          value={scannerId ?? ""}
          onChange={(e) => setScannerId(Number(e.target.value))}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
        >
          {hosts.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name} ({h.lan_ip})
            </option>
          ))}
        </select>
        <button
          onClick={runScan}
          disabled={scanning || !scannerId}
          className="rounded bg-blue-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
        >
          {scanning ? "Scan en cours (~5s)..." : "Lancer le scan"}
        </button>
        {hosts.length === 0 && (
          <p className="text-sm text-neutral-500">
            Aucune machine avec une IP LAN renseignée — ajoute-en une dans l&apos;inventaire d&apos;abord.
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {devices && (
        <div className="space-y-4">
          {unknown.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-medium text-amber-300">
                {unknown.length} appareil{unknown.length > 1 ? "s" : ""} non référencé{unknown.length > 1 ? "s" : ""}
              </h2>
              <div className="overflow-auto rounded border border-neutral-800">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-900 text-left text-neutral-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">IP</th>
                      <th className="px-3 py-2 font-medium">Adresse MAC</th>
                      <th className="px-3 py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unknown.map((d) => (
                      <tr key={d.ip} className="border-t border-neutral-800">
                        <td className="px-3 py-2 font-mono text-xs">{d.ip}</td>
                        <td className="px-3 py-2 font-mono text-xs text-neutral-400">{d.mac ?? "—"}</td>
                        <td className="px-3 py-2">
                          <button
                            onClick={() => addToInventory(d)}
                            className="rounded border border-blue-700 bg-blue-900/40 px-2 py-0.5 text-xs text-blue-200 hover:bg-blue-900/60"
                          >
                            + Ajouter à l&apos;inventaire
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div>
            <h2 className="mb-2 text-sm font-medium text-neutral-400">
              {known.length} appareil{known.length > 1 ? "s" : ""} déjà référencé{known.length > 1 ? "s" : ""}
            </h2>
            {known.length === 0 ? (
              <p className="text-sm text-neutral-500">Aucun.</p>
            ) : (
              <ul className="text-sm text-neutral-500">
                {known.map((d) => (
                  <li key={d.ip} className="font-mono text-xs">
                    {d.ip} {d.mac ? `(${d.mac})` : ""}
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
