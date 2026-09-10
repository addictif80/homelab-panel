import type { DnsProviderClient, DnsRecord, UpsertRecordInput } from "../types";

type NamecheapHost = { hostId: string; name: string; type: string; address: string; ttl: string };

/**
 * Namecheap has no per-record CRUD endpoint — `setHosts` replaces the entire record list for the
 * domain in one call, so every operation here reads the full list, edits it in memory, and
 * resubmits it whole. Records are identified by Namecheap's own HostId, which it reassigns on
 * every setHosts call, so callers should always re-list after a mutation rather than reuse ids.
 */
export function createNamecheapClient(config: Record<string, string>, secret: Record<string, string>): DnsProviderClient {
  const { sld, tld, apiUser, username, clientIp } = config;
  const apiKey = secret.apiKey;

  function baseParams(): URLSearchParams {
    return new URLSearchParams({
      ApiUser: apiUser,
      ApiKey: apiKey,
      UserName: username,
      ClientIp: clientIp,
      SLD: sld,
      TLD: tld,
    });
  }

  // Namecheap's XML responses are a small, fixed shape (flat self-closing <host .../> tags) —
  // not worth a full XML parser dependency for that, a couple of targeted regexes are enough.
  function extractAttrs(tag: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const m of tag.matchAll(/(\w+)="([^"]*)"/g)) attrs[m[1]] = m[2];
    return attrs;
  }

  async function apiCall(command: string, extra: Record<string, string> = {}): Promise<string> {
    const params = baseParams();
    params.set("Command", command);
    for (const [k, v] of Object.entries(extra)) params.set(k, v);

    const res = await fetch(`https://api.namecheap.com/xml.response?${params.toString()}`);
    const text = await res.text();

    const statusMatch = text.match(/<ApiResponse\s+Status="([^"]+)"/);
    if (statusMatch?.[1] === "ERROR") {
      const errorMatch = text.match(/<Error[^>]*>([^<]*)<\/Error>/);
      throw new Error(`Namecheap API : ${errorMatch?.[1] || "erreur inconnue"}`);
    }
    return text;
  }

  function domain(): string {
    return `${sld}.${tld}`;
  }

  async function getHosts(): Promise<NamecheapHost[]> {
    const text = await apiCall("namecheap.domains.dns.getHosts");
    const hostTags = text.match(/<host\s[^>]*\/?>/g) || [];
    return hostTags.map((tag) => {
      const a = extractAttrs(tag);
      return { hostId: a.HostId || "", name: a.Name || "", type: a.Type || "", address: a.Address || "", ttl: a.TTL || "1800" };
    });
  }

  async function setHosts(hosts: NamecheapHost[]): Promise<void> {
    const params: Record<string, string> = {};
    hosts.forEach((h, i) => {
      const n = i + 1;
      params[`HostName${n}`] = h.name;
      params[`RecordType${n}`] = h.type;
      params[`Address${n}`] = h.address;
      params[`TTL${n}`] = h.ttl;
    });
    await apiCall("namecheap.domains.dns.setHosts", params);
  }

  function toDnsRecord(h: NamecheapHost): DnsRecord {
    return {
      id: h.hostId,
      type: h.type,
      name: h.name === "@" ? domain() : `${h.name}.${domain()}`,
      content: h.address,
      ttl: Number(h.ttl),
    };
  }

  function toSubName(name: string): string {
    const d = domain();
    if (name === "@" || name === d) return "@";
    return name.endsWith(`.${d}`) ? name.slice(0, -(d.length + 1)) : name;
  }

  return {
    async listRecords(): Promise<DnsRecord[]> {
      return (await getHosts()).map(toDnsRecord);
    },

    async createRecord(input: UpsertRecordInput): Promise<DnsRecord> {
      const hosts = await getHosts();
      const newHost: NamecheapHost = {
        hostId: "",
        name: toSubName(input.name),
        type: input.type,
        address: input.content,
        ttl: String(input.ttl || 1800),
      };
      await setHosts([...hosts, newHost]);
      return toDnsRecord(newHost);
    },

    async updateRecord(recordId: string, input: UpsertRecordInput): Promise<DnsRecord> {
      const hosts = await getHosts();
      const updated = hosts.map((h) =>
        h.hostId === recordId
          ? { ...h, name: toSubName(input.name), type: input.type, address: input.content, ttl: String(input.ttl || 1800) }
          : h
      );
      await setHosts(updated);
      return toDnsRecord(updated.find((h) => h.hostId === recordId) || updated[updated.length - 1]);
    },

    async deleteRecord(recordId: string): Promise<void> {
      const hosts = await getHosts();
      await setHosts(hosts.filter((h) => h.hostId !== recordId));
    },
  };
}
