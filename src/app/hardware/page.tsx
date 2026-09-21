"use client";

import { useEffect, useState } from "react";

type Host = { id: number; name: string; kind: string };

type TemperatureReading = { label: string; celsius: number };
type DiskHealth = {
  device: string;
  healthy: boolean | null;
  temperatureC: number | null;
  reallocatedSectors: number | null;
  note: string | null;
};
type UpsStatus = { status: string; chargePercent: number | null };
type HardwareHealth = { temperatures: TemperatureReading[]; disks: DiskHealth[]; ups: UpsStatus | null; toolsMissing: string[] };

type HostState = { loading: boolean; health: HardwareHealth | null; error: string | null };

type HostPowerCost = {
  hostId: number;
  hostName: string;
  configured: boolean;
  avgCpuPercent: number | null;
  avgWatts: number | null;
  sampleCount: number;
  estimatedMonthlyKwh: number | null;
  estimatedMonthlyCost: number | null;
};
type PowerCostSummary = {
  pricePerKwh: number;
  hosts: HostPowerCost[];
  totalMonthlyCost: number;
  totalMonthlyKwh: number;
  unconfiguredHostNames: string[];
};

function formatEur(value: number): string {
  return value.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
}

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

      <ElectricityCostSection />

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
                          <div key={d.device}>
                            <div className="flex items-center gap-2 text-xs">
                              <span className="font-mono text-neutral-300">/dev/{d.device}</span>
                              <span className={d.healthy === false ? "text-red-400" : d.healthy ? "text-emerald-400" : "text-neutral-500"}>
                                {d.healthy === false ? "FAILED" : d.healthy ? "PASSED" : "inconnu"}
                              </span>
                              {d.temperatureC !== null && <span className={tempColor(d.temperatureC)}>{d.temperatureC}°C</span>}
                              {d.reallocatedSectors !== null && d.reallocatedSectors > 0 && (
                                <span className="text-amber-400">{d.reallocatedSectors} secteurs réalloués</span>
                              )}
                            </div>
                            {d.note && <p className="mt-0.5 pl-1 text-[11px] text-neutral-500">{d.note}</p>}
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

/** Estimated, never claimed as measured: watts come from what the user entered per host
 * (inventaire), averaged against real CPU load samples collected every 15 min (lib/power/recorder.ts)
 * — a host with no idle/max wattage filled in is listed as "not configured" rather than silently
 * left out of the total or guessed at with a generic number. */
function ElectricityCostSection() {
  const [summary, setSummary] = useState<PowerCostSummary | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => {
    fetch("/api/power/cost")
      .then((r) => r.json())
      .then((d: PowerCostSummary) => {
        setSummary(d);
        setPriceInput(String(d.pricePerKwh));
      })
      .catch(() => setSummary(null));
  };

  useEffect(load, []);

  async function savePrice() {
    const price = Number(priceInput.replace(",", "."));
    if (!Number.isFinite(price) || price <= 0) return;
    setSaving(true);
    await fetch("/api/power/cost", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pricePerKwh: price }),
    });
    setSaving(false);
    load();
  }

  if (!summary) return null;

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-100">Coût électrique estimé</h2>
        <div className="flex items-center gap-1.5 text-xs text-neutral-400">
          <span>Prix du kWh :</span>
          <input
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            className="w-16 rounded border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 text-right font-mono text-xs"
          />
          <span>€</span>
          <button
            onClick={savePrice}
            disabled={saving}
            className="rounded border border-neutral-700 px-2 py-0.5 hover:bg-neutral-800 disabled:opacity-50"
          >
            OK
          </button>
        </div>
      </div>
      <p className="mb-3 text-xs text-neutral-500">
        Estimation à partir de la consommation à vide/en charge que tu renseignes par machine (inventaire) et de la
        charge CPU moyenne réelle des 30 derniers jours — pas une mesure directe, à ajuster avec tes propres chiffres
        si tu as une prise connectée.
      </p>

      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums text-neutral-100">{formatEur(summary.totalMonthlyCost)}</span>
        <span className="text-xs text-neutral-500">estimé / mois ({summary.totalMonthlyKwh.toFixed(1)} kWh)</span>
      </div>

      <div className="space-y-1.5">
        {summary.hosts.map((h) => (
          <div key={h.hostId} className="flex items-center justify-between text-xs">
            <span className="text-neutral-300">{h.hostName}</span>
            {h.configured ? (
              h.estimatedMonthlyCost !== null ? (
                <span className="text-neutral-400">
                  {formatEur(h.estimatedMonthlyCost)} ({h.avgWatts!.toFixed(0)} W moy., {h.avgCpuPercent!.toFixed(0)}% CPU)
                </span>
              ) : (
                <span className="text-neutral-600">Pas encore d&apos;échantillon (attends ~15 min)</span>
              )
            ) : (
              <span className="text-neutral-600">Watts non renseignés</span>
            )}
          </div>
        ))}
      </div>

      {summary.unconfiguredHostNames.length > 0 && (
        <p className="mt-3 text-[11px] text-neutral-600">
          Renseigne la consommation au repos/en charge de {summary.unconfiguredHostNames.join(", ")} dans
          l&apos;inventaire pour les inclure dans l&apos;estimation.
        </p>
      )}
    </div>
  );
}
