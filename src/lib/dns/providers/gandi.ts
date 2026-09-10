import type { DnsProviderClient, DnsRecord, UpsertRecordInput } from "../types";

type GandiRrset = { rrset_name: string; rrset_type: string; rrset_ttl: number; rrset_values: string[] };

/** Gandi's LiveDNS API has no per-record numeric id — a record is addressed by its
 * (name, type) pair, and each pair can hold multiple values (e.g. several A records). This
 * module treats each value as its own DnsRecord, synthesizing an id of "name:type:value" so the
 * panel's per-record edit/delete UI still works despite Gandi grouping them server-side. */
function encodeId(name: string, type: string, value: string): string {
  return `${encodeURIComponent(name)}:${encodeURIComponent(type)}:${encodeURIComponent(value)}`;
}

function decodeId(id: string): { name: string; type: string; value: string } {
  const [name, type, value] = id.split(":").map(decodeURIComponent);
  return { name, type, value };
}

export function createGandiClient(config: Record<string, string>, secret: Record<string, string>): DnsProviderClient {
  const domain = config.domain;
  const token = secret.apiToken;

  async function gandiFetch(path: string, options: RequestInit = {}) {
    const res = await fetch(`https://api.gandi.net/v5/livedns/domains/${domain}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(`Gandi API : ${data.message || res.statusText}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async function getRrset(name: string, type: string): Promise<GandiRrset | null> {
    try {
      return (await gandiFetch(`/records/${encodeURIComponent(name)}/${type}`)) as GandiRrset;
    } catch {
      return null;
    }
  }

  return {
    async listRecords(): Promise<DnsRecord[]> {
      const rrsets = (await gandiFetch(`/records`)) as GandiRrset[];
      return rrsets.flatMap((r) =>
        r.rrset_values.map((value) => ({
          id: encodeId(r.rrset_name, r.rrset_type, value),
          type: r.rrset_type,
          name: r.rrset_name === "@" ? domain : `${r.rrset_name}.${domain}`,
          content: value,
          ttl: r.rrset_ttl,
        }))
      );
    },

    async createRecord(input: UpsertRecordInput): Promise<DnsRecord> {
      const name = input.name === domain ? "@" : input.name.replace(`.${domain}`, "");
      const existing = await getRrset(name, input.type);
      const values = existing ? [...existing.rrset_values, input.content] : [input.content];

      await gandiFetch(`/records/${encodeURIComponent(name)}/${input.type}`, {
        method: "PUT",
        body: JSON.stringify({ rrset_ttl: input.ttl || 3600, rrset_values: values }),
      });
      return { id: encodeId(name, input.type, input.content), type: input.type, name: input.name, content: input.content, ttl: input.ttl || 3600 };
    },

    async updateRecord(recordId: string, input: UpsertRecordInput): Promise<DnsRecord> {
      const { name: oldName, type: oldType, value: oldValue } = decodeId(recordId);
      const newName = input.name === domain ? "@" : input.name.replace(`.${domain}`, "");

      if (oldName === newName && oldType === input.type) {
        const existing = await getRrset(oldName, oldType);
        const values = (existing?.rrset_values ?? []).map((v) => (v === oldValue ? input.content : v));
        await gandiFetch(`/records/${encodeURIComponent(oldName)}/${oldType}`, {
          method: "PUT",
          body: JSON.stringify({ rrset_ttl: input.ttl || 3600, rrset_values: values }),
        });
      } else {
        // Name or type changed — Gandi has no rename, so remove the old value and add the new one.
        const existing = await getRrset(oldName, oldType);
        const remaining = (existing?.rrset_values ?? []).filter((v) => v !== oldValue);
        if (remaining.length > 0) {
          await gandiFetch(`/records/${encodeURIComponent(oldName)}/${oldType}`, {
            method: "PUT",
            body: JSON.stringify({ rrset_ttl: existing?.rrset_ttl || 3600, rrset_values: remaining }),
          });
        } else {
          await gandiFetch(`/records/${encodeURIComponent(oldName)}/${oldType}`, { method: "DELETE" });
        }
        const target = await getRrset(newName, input.type);
        const values = target ? [...target.rrset_values, input.content] : [input.content];
        await gandiFetch(`/records/${encodeURIComponent(newName)}/${input.type}`, {
          method: "PUT",
          body: JSON.stringify({ rrset_ttl: input.ttl || 3600, rrset_values: values }),
        });
      }

      return { id: encodeId(newName, input.type, input.content), type: input.type, name: input.name, content: input.content, ttl: input.ttl || 3600 };
    },

    async deleteRecord(recordId: string): Promise<void> {
      const { name, type, value } = decodeId(recordId);
      const existing = await getRrset(name, type);
      const remaining = (existing?.rrset_values ?? []).filter((v) => v !== value);
      if (remaining.length > 0) {
        await gandiFetch(`/records/${encodeURIComponent(name)}/${type}`, {
          method: "PUT",
          body: JSON.stringify({ rrset_ttl: existing?.rrset_ttl || 3600, rrset_values: remaining }),
        });
      } else {
        await gandiFetch(`/records/${encodeURIComponent(name)}/${type}`, { method: "DELETE" });
      }
    },
  };
}
