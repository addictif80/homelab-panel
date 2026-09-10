import { getSetting, setSetting } from "./db";
import { vaultDecrypt, vaultEncrypt } from "./crypto";

const CONFIG_KEY = "cloudflare_dns_config";
const TOKEN_KEY = "cloudflare_dns_token_encrypted";

export type CloudflareDnsConfig = { zoneId: string; zoneName: string };

export function getDnsConfig(): CloudflareDnsConfig | null {
  const raw = getSetting(CONFIG_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function hasDnsToken(): boolean {
  return !!getSetting(TOKEN_KEY);
}

export function setDnsConfig(config: CloudflareDnsConfig, token?: string): void {
  setSetting(CONFIG_KEY, JSON.stringify(config));
  if (token) setSetting(TOKEN_KEY, vaultEncrypt(token));
}

async function cfFetch(path: string, options: RequestInit = {}) {
  const encryptedToken = getSetting(TOKEN_KEY);
  if (!encryptedToken) throw new Error("Cloudflare n'est pas configuré.");
  const token = vaultDecrypt(encryptedToken);

  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const data = await res.json();
  if (!res.ok || data.success === false) {
    const message = data.errors?.[0]?.message || res.statusText;
    throw new Error(`Cloudflare API : ${message}`);
  }
  return data.result;
}

export type DnsRecord = {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
};

export async function listRecords(): Promise<DnsRecord[]> {
  const config = getDnsConfig();
  if (!config) throw new Error("Cloudflare n'est pas configuré.");
  return (await cfFetch(`/zones/${config.zoneId}/dns_records?per_page=100`)) as DnsRecord[];
}

export type UpsertRecordInput = {
  type: string;
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
};

export async function createRecord(input: UpsertRecordInput): Promise<DnsRecord> {
  const config = getDnsConfig();
  if (!config) throw new Error("Cloudflare n'est pas configuré.");
  return (await cfFetch(`/zones/${config.zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify({ ttl: 1, proxied: false, ...input }),
  })) as DnsRecord;
}

export async function updateRecord(recordId: string, input: UpsertRecordInput): Promise<DnsRecord> {
  const config = getDnsConfig();
  if (!config) throw new Error("Cloudflare n'est pas configuré.");
  return (await cfFetch(`/zones/${config.zoneId}/dns_records/${recordId}`, {
    method: "PUT",
    body: JSON.stringify({ ttl: 1, proxied: false, ...input }),
  })) as DnsRecord;
}

export async function deleteRecord(recordId: string): Promise<void> {
  const config = getDnsConfig();
  if (!config) throw new Error("Cloudflare n'est pas configuré.");
  await cfFetch(`/zones/${config.zoneId}/dns_records/${recordId}`, { method: "DELETE" });
}

export async function testDnsConnection(): Promise<void> {
  await listRecords();
}
