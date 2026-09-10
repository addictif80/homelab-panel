import { createHash } from "crypto";
import type { DnsProviderClient, DnsRecord, UpsertRecordInput } from "../types";

const ENDPOINT_HOSTS: Record<string, string> = {
  "ovh-eu": "https://eu.api.ovh.com/1.0",
  "ovh-ca": "https://ca.api.ovh.com/1.0",
  "ovh-us": "https://api.us.ovhcloud.com/1.0",
};

type OvhRecord = {
  id: number;
  fieldType: string;
  subDomain: string;
  target: string;
  ttl: number;
  zone: string;
};

function fromRaw(r: OvhRecord, zoneName: string): DnsRecord {
  return {
    id: String(r.id),
    type: r.fieldType,
    name: r.subDomain ? `${r.subDomain}.${zoneName}` : zoneName,
    content: r.target,
    ttl: r.ttl || 0,
  };
}

/** OVH records are relative to the zone (subDomain, not FQDN) — strips the zone suffix and "@"
 * placeholder that Cloudflare-style tools use for the apex record. */
function toSubDomain(name: string, zoneName: string): string {
  if (name === "@" || name === zoneName) return "";
  return name.endsWith(`.${zoneName}`) ? name.slice(0, -(zoneName.length + 1)) : name;
}

export function createOvhClient(config: Record<string, string>, secret: Record<string, string>): DnsProviderClient {
  const zoneName = config.zoneName;
  const baseUrl = ENDPOINT_HOSTS[config.endpoint] || ENDPOINT_HOSTS["ovh-eu"];
  const { applicationKey, applicationSecret, consumerKey } = secret;

  let timeOffset: number | null = null;

  async function getServerTime(): Promise<number> {
    if (timeOffset !== null) return Math.floor(Date.now() / 1000) + timeOffset;
    const res = await fetch(`${baseUrl}/auth/time`);
    const serverTime = Number(await res.text());
    timeOffset = serverTime - Math.floor(Date.now() / 1000);
    return serverTime;
  }

  async function ovhFetch(path: string, method = "GET", body?: unknown): Promise<unknown> {
    const url = `${baseUrl}${path}`;
    const timestamp = await getServerTime();
    const bodyStr = body !== undefined ? JSON.stringify(body) : "";

    const signature =
      "$1$" +
      createHash("sha1")
        .update(`${applicationSecret}+${consumerKey}+${method}+${url}+${bodyStr}+${timestamp}`)
        .digest("hex");

    const res = await fetch(url, {
      method,
      headers: {
        "X-Ovh-Application": applicationKey,
        "X-Ovh-Consumer": consumerKey,
        "X-Ovh-Timestamp": String(timestamp),
        "X-Ovh-Signature": signature,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: bodyStr || undefined,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(`OVH API : ${data.message || res.statusText}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async function refreshZone(): Promise<void> {
    // OVH only applies pending record changes to the live zone after an explicit refresh call.
    await ovhFetch(`/domain/zone/${zoneName}/refresh`, "POST");
  }

  return {
    async listRecords(): Promise<DnsRecord[]> {
      const ids = (await ovhFetch(`/domain/zone/${zoneName}/record`)) as number[];
      const records = await Promise.all(
        ids.map((id) => ovhFetch(`/domain/zone/${zoneName}/record/${id}`) as Promise<OvhRecord>)
      );
      return records.map((r) => fromRaw(r, zoneName));
    },

    async createRecord(input: UpsertRecordInput): Promise<DnsRecord> {
      const created = (await ovhFetch(`/domain/zone/${zoneName}/record`, "POST", {
        fieldType: input.type,
        subDomain: toSubDomain(input.name, zoneName),
        target: input.content,
        ttl: input.ttl || 3600,
      })) as OvhRecord;
      await refreshZone();
      return fromRaw(created, zoneName);
    },

    async updateRecord(recordId: string, input: UpsertRecordInput): Promise<DnsRecord> {
      await ovhFetch(`/domain/zone/${zoneName}/record/${recordId}`, "PUT", {
        subDomain: toSubDomain(input.name, zoneName),
        target: input.content,
        ttl: input.ttl || 3600,
      });
      await refreshZone();
      const updated = (await ovhFetch(`/domain/zone/${zoneName}/record/${recordId}`)) as OvhRecord;
      return fromRaw(updated, zoneName);
    },

    async deleteRecord(recordId: string): Promise<void> {
      await ovhFetch(`/domain/zone/${zoneName}/record/${recordId}`, "DELETE");
      await refreshZone();
    },
  };
}
