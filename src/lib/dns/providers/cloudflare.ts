import type { DnsProviderClient, DnsRecord, UpsertRecordInput } from "../types";

export function createCloudflareClient(config: Record<string, string>, secret: Record<string, string>): DnsProviderClient {
  const zoneId = config.zoneId;
  const token = secret.apiToken;

  async function cfFetch(path: string, options: RequestInit = {}) {
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

  return {
    async listRecords(): Promise<DnsRecord[]> {
      return (await cfFetch(`/zones/${zoneId}/dns_records?per_page=100`)) as DnsRecord[];
    },
    async createRecord(input: UpsertRecordInput): Promise<DnsRecord> {
      return (await cfFetch(`/zones/${zoneId}/dns_records`, {
        method: "POST",
        body: JSON.stringify({ ttl: 1, proxied: false, ...input }),
      })) as DnsRecord;
    },
    async updateRecord(recordId: string, input: UpsertRecordInput): Promise<DnsRecord> {
      return (await cfFetch(`/zones/${zoneId}/dns_records/${recordId}`, {
        method: "PUT",
        body: JSON.stringify({ ttl: 1, proxied: false, ...input }),
      })) as DnsRecord;
    },
    async deleteRecord(recordId: string): Promise<void> {
      await cfFetch(`/zones/${zoneId}/dns_records/${recordId}`, { method: "DELETE" });
    },
  };
}
