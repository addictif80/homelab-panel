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

      <ThroughputSection />

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

type ThroughputResult = {
  sourceHostId: number;
  sourceHostName: string;
  targetHostId: number;
  targetHostName: string;
  mbps: number | null;
  error: string | null;
};
type ThroughputState = { running: boolean; runId: string | null; pairCount: number; results: ThroughputResult[] };

function speedColor(mbps: number | null): string {
  if (mbps === null) return "text-neutral-600";
  if (mbps < 100) return "text-amber-400";
  return "text-emerald-400";
}

/**
 * Real data pushed machine-to-machine over each host's own SSH connection (see lib/throughput.ts)
 * — reuses the backup feature's dedicated keypair rather than a synthetic loopback, so the number
 * reflects the actual path between two machines (same switch, different VLAN, over a VPN, across
 * the internet...), not a theoretical NIC speed. Manual-trigger only: N machines means N×(N-1)
 * real transfers, never something to run unattended in the background.
 */
function ThroughputSection() {
  const [state, setState] = useState<ThroughputState | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/throughput");
    setState(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!state?.running) return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [state?.running, load]);

  async function start() {
    setStarting(true);
    setError("");
    try {
      const res = await fetch("/api/throughput", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-100">Test de débit réel entre les machines</h2>
        <button
          onClick={start}
          disabled={starting || state?.running || !state?.pairCount}
          className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800 disabled:opacity-50"
        >
          {state?.running ? "Test en cours..." : "Lancer le test"}
        </button>
      </div>
      <p className="mb-3 text-xs text-neutral-500">
        Transfère 64 Mo réels d&apos;une machine à l&apos;autre, pour chaque paire, en mesurant le temps écoulé — le
        vrai débit constaté entre deux machines (même switch, VPN, à travers internet...), pas une vitesse
        théorique de carte réseau.
      </p>

      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}

      {state && state.pairCount === 0 && (
        <p className="text-xs text-neutral-600">
          Il faut au moins deux machines physiques/VPS/NAS dans l&apos;inventaire pour tester une paire.
        </p>
      )}

      {state && state.results.length > 0 && (
        <div className="overflow-auto rounded border border-neutral-800">
          <table className="w-full text-xs">
            <thead className="bg-neutral-950 text-left text-neutral-500">
              <tr>
                <th className="px-2 py-1.5 font-medium">Source</th>
                <th className="px-2 py-1.5 font-medium">Destination</th>
                <th className="px-2 py-1.5 font-medium">Débit</th>
              </tr>
            </thead>
            <tbody>
              {state.results.map((r, i) => (
                <tr key={i} className="border-t border-neutral-900">
                  <td className="px-2 py-1.5">{r.sourceHostName}</td>
                  <td className="px-2 py-1.5">{r.targetHostName}</td>
                  <td className={`px-2 py-1.5 font-mono ${speedColor(r.mbps)}`}>
                    {r.mbps !== null ? `${r.mbps.toFixed(0)} Mb/s` : r.error || "échec"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {state.running && (
            <p className="border-t border-neutral-900 px-2 py-1.5 text-neutral-500">
              {state.results.length} / {state.pairCount} paires testées...
            </p>
          )}
        </div>
      )}
    </div>
  );
}
