import { getSetting, setSetting } from "./db";
import { vaultDecrypt, vaultEncrypt } from "./crypto";

const SETTING_KEY = "tailscale_config";
const API_BASE = "https://api.tailscale.com/api/v2";

type TailscaleConfig = { apiKey: string; tailnet: string };

export function getTailscaleConfig(): TailscaleConfig | null {
  const raw = getSetting(SETTING_KEY);
  if (!raw) return null;
  return JSON.parse(vaultDecrypt(raw));
}

export function setTailscaleConfig(config: TailscaleConfig) {
  setSetting(SETTING_KEY, vaultEncrypt(JSON.stringify(config)));
}

export type TailscaleDevice = {
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

async function tailscaleFetch(path: string, options: RequestInit = {}) {
  const config = getTailscaleConfig();
  if (!config) throw new Error("Tailscale n'est pas configuré.");

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Tailscale API ${res.status}: ${text || res.statusText}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function listDevices(): Promise<TailscaleDevice[]> {
  const config = getTailscaleConfig();
  if (!config) throw new Error("Tailscale n'est pas configuré.");

  const data = await tailscaleFetch(`/tailnet/${encodeURIComponent(config.tailnet)}/devices`);
  return (data.devices || []).map((d: Record<string, unknown>) => ({
    id: d.id,
    hostname: d.hostname,
    name: d.name,
    addresses: d.addresses,
    os: d.os,
    authorized: d.authorized,
    online: d.lastSeen
      ? Date.now() - new Date(d.lastSeen as string).getTime() < 5 * 60 * 1000
      : false,
    lastSeen: d.lastSeen,
    clientVersion: d.clientVersion,
  }));
}

export async function setDeviceAuthorized(deviceId: string, authorized: boolean): Promise<void> {
  await tailscaleFetch(`/device/${deviceId}/authorized`, {
    method: "POST",
    body: JSON.stringify({ authorized }),
  });
}

export async function removeDevice(deviceId: string): Promise<void> {
  await tailscaleFetch(`/device/${deviceId}`, { method: "DELETE" });
}
