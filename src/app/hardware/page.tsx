"use client";

import { useEffect, useState } from "react";

type Host = { id: number; name: string; kind: string };

type TemperatureReading = { label: string; celsius: number };
type DiskHealth = { device: string; healthy: boolean | null; temperatureC: number | null; reallocatedSectors: number | null };
type UpsStatus = { status: string; chargePercent: number | null };
type HardwareHealth = { temperatures: TemperatureReading[]; disks: DiskHealth[]; ups: UpsStatus | null; toolsMissing: string[] };

type HostState = { loading: boolean; health: HardwareHealth | null; error: string | null };

function tempColor(celsius: number): string {
  if (celsius >= 75) return "text-red-400";
  if (celsius >= 60) return "text-amber-400";
  return "text-emerald-400";
}

export default function HardwarePage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [states, setStates] = useState<Record<number, HostState>>({});

  useEffect(() => {
    fetch("/api/hosts")
      .then((r) => r.json())
      .then((d) => setHosts(d.hosts.filter((h: Host) => ["physical", "vps", "nas"].includes(h.kind))));
  }, []);

  async function refresh(hostId: number) {
    setStates((s) => ({ ...s, [hostId]: { loading: true, health: s[hostId]?.health ?? null, error: null } }));
    try {
      const res = await fetch(`/api/hosts/${hostId}/health`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur.");
      setStates((s) => ({ ...s, [hostId]: { loading: false, health: data.health, error: null } }));
    } catch (err) {
      setStates((s) => ({
        ...s,
        [hostId]: { loading: false, health: null, error: err instanceof Error ? err.message : "Erreur." },
      }));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Santé matérielle</h1>
        <p className="text-sm text-neutral-400">
          Température, état SMART des disques et onduleur (UPS) — lus en direct via SSH (sensors, smartctl,
          upsc/apcaccess). Nécessite ces outils installés sur la machine ; sinon le panel te le signale plutôt que
          d&apos;échouer silencieusement.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {hosts.map((h) => {
          const state = states[h.id];
          return (
            <div key={h.id} className="rounded border border-neutral-800 bg-neutral-900 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-neutral-100">{h.name}</h2>
                <button
                  onClick={() => refresh(h.id)}
                  disabled={state?.loading}
                  className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800 disabled:opacity-50"
                >
                  {state?.loading ? "Lecture..." : "Actualiser"}
                </button>
              </div>

              {state?.error && <p className="mt-2 text-xs text-red-400">{state.error}</p>}

              {state?.health && (
                <div className="mt-3 space-y-3 text-sm">
                  {state.health.temperatures.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-neutral-400">Températures</p>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {state.health.temperatures.map((t, i) => (
                          <span key={i} className={`rounded border border-neutral-700 px-2 py-0.5 text-xs ${tempColor(t.celsius)}`}>
                            {t.label} : {t.celsius.toFixed(0)}°C
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {state.health.disks.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-neutral-400">Disques (SMART)</p>
                      <div className="mt-1 space-y-1">
                        {state.health.disks.map((d) => (
                          <div key={d.device} className="flex items-center gap-2 text-xs">
                            <span className="font-mono text-neutral-300">/dev/{d.device}</span>
                            <span className={d.healthy === false ? "text-red-400" : d.healthy ? "text-emerald-400" : "text-neutral-500"}>
                              {d.healthy === false ? "FAILED" : d.healthy ? "PASSED" : "inconnu"}
                            </span>
                            {d.temperatureC !== null && <span className={tempColor(d.temperatureC)}>{d.temperatureC}°C</span>}
                            {d.reallocatedSectors !== null && d.reallocatedSectors > 0 && (
                              <span className="text-amber-400">{d.reallocatedSectors} secteurs réalloués</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {state.health.ups && (
                    <div>
                      <p className="text-xs font-medium text-neutral-400">Onduleur (UPS)</p>
                      <p className="text-xs text-neutral-300">
                        {state.health.ups.status}
                        {state.health.ups.chargePercent !== null && ` — ${state.health.ups.chargePercent}% de charge`}
                      </p>
                    </div>
                  )}

                  {state.health.toolsMissing.length > 0 && (
                    <p className="text-[11px] text-neutral-600">
                      Non disponible : {state.health.toolsMissing.join(", ")} — installe ces outils sur la machine
                      pour voir ces données.
                    </p>
                  )}

                  {state.health.temperatures.length === 0 && state.health.disks.length === 0 && !state.health.ups && (
                    <p className="text-xs text-neutral-500">Aucune donnée disponible sur cette machine.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {hosts.length === 0 && <p className="text-sm text-neutral-500">Aucune machine SSH dans l&apos;inventaire.</p>}
      </div>
    </div>
  );
}
