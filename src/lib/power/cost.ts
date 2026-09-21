import { getDb, getSetting, setSetting } from "../db";

const PRICE_KEY = "electricity_price_per_kwh";
/** Roughly the French regulated residential rate at time of writing — a starting point, not a
 * claim of accuracy; the whole point of the setting is that the user overrides it with their own
 * real tariff. */
const DEFAULT_PRICE_EUR = 0.2016;

export function getElectricityPrice(): number {
  const raw = getSetting(PRICE_KEY);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PRICE_EUR;
}

export function setElectricityPrice(pricePerKwh: number): void {
  setSetting(PRICE_KEY, String(pricePerKwh));
}

type HostRow = { id: number; name: string; watts_idle: number | null; watts_max: number | null };

export type HostPowerCost = {
  hostId: number;
  hostName: string;
  configured: boolean;
  avgCpuPercent: number | null;
  avgWatts: number | null;
  sampleCount: number;
  estimatedMonthlyKwh: number | null;
  estimatedMonthlyCost: number | null;
};

export type PowerCostSummary = {
  pricePerKwh: number;
  hosts: HostPowerCost[];
  totalMonthlyCost: number;
  totalMonthlyKwh: number;
  unconfiguredHostNames: string[];
};

/** Linear interpolation between a host's own measured idle/max draw and its recent average CPU
 * load — not a generic "servers use ~X watts" table, since that varies wildly by model, PSU
 * efficiency and attached disks, and a wrong generic number would be worse than being upfront
 * that a host needs its watts filled in before it's included at all. */
export function getPowerCostSummary(days = 30): PowerCostSummary {
  const db = getDb();
  const hosts = db
    .prepare(`SELECT id, name, watts_idle, watts_max FROM hosts WHERE kind IN ('physical','vps','nas')`)
    .all() as HostRow[];

  const pricePerKwh = getElectricityPrice();
  const hostResults: HostPowerCost[] = [];
  const unconfiguredHostNames: string[] = [];
  let totalMonthlyCost = 0;
  let totalMonthlyKwh = 0;

  for (const host of hosts) {
    const configured = host.watts_idle !== null && host.watts_max !== null;
    if (!configured) unconfiguredHostNames.push(host.name);

    const samples = db
      .prepare(`SELECT cpu_percent FROM power_samples WHERE host_id = ? AND recorded_at >= datetime('now', ?)`)
      .all(host.id, `-${days} days`) as { cpu_percent: number }[];

    const avgCpuPercent = samples.length > 0 ? samples.reduce((sum, s) => sum + s.cpu_percent, 0) / samples.length : null;

    let avgWatts: number | null = null;
    let estimatedMonthlyKwh: number | null = null;
    let estimatedMonthlyCost: number | null = null;

    if (configured && avgCpuPercent !== null) {
      avgWatts = host.watts_idle! + ((host.watts_max! - host.watts_idle!) * avgCpuPercent) / 100;
      estimatedMonthlyKwh = (avgWatts / 1000) * 24 * 30;
      estimatedMonthlyCost = estimatedMonthlyKwh * pricePerKwh;
      totalMonthlyCost += estimatedMonthlyCost;
      totalMonthlyKwh += estimatedMonthlyKwh;
    }

    hostResults.push({
      hostId: host.id,
      hostName: host.name,
      configured,
      avgCpuPercent,
      avgWatts,
      sampleCount: samples.length,
      estimatedMonthlyKwh,
      estimatedMonthlyCost,
    });
  }

  return {
    pricePerKwh,
    hosts: hostResults.sort((a, b) => a.hostName.localeCompare(b.hostName)),
    totalMonthlyCost,
    totalMonthlyKwh,
    unconfiguredHostNames,
  };
}
