import { randomUUID } from "crypto";
import { getSetting, setSetting } from "../db";
import { vaultDecrypt, vaultEncrypt } from "../crypto";
import { createCloudflareClient } from "./providers/cloudflare";
import { createOvhClient } from "./providers/ovh";
import { createGandiClient } from "./providers/gandi";
import { createNamecheapClient } from "./providers/namecheap";
import type { DnsProviderClient, DnsProviderType } from "./types";

export * from "./types";

const ZONES_KEY = "dns_zones";
const LEGACY_CONFIG_KEY = "cloudflare_dns_config";
const LEGACY_TOKEN_KEY = "cloudflare_dns_token_encrypted";

export type DnsZone = {
  id: string;
  provider: DnsProviderType;
  label: string;
  config: Record<string, string>;
};

type StoredZone = DnsZone & { secretEncrypted: string };

function loadZones(): StoredZone[] {
  const raw = getSetting(ZONES_KEY);
  if (raw) return JSON.parse(raw);

  // One-off migration: the first cut of DNS management only supported a single Cloudflare zone
  // stored under its own settings keys — fold it into the new multi-provider list so nobody who
  // already configured it loses their setup on upgrade.
  const legacyConfig = getSetting(LEGACY_CONFIG_KEY);
  const legacyToken = getSetting(LEGACY_TOKEN_KEY);
  if (legacyConfig && legacyToken) {
    const parsed = JSON.parse(legacyConfig) as { zoneId: string; zoneName: string };
    const migrated: StoredZone[] = [
      {
        id: randomUUID(),
        provider: "cloudflare",
        label: parsed.zoneName,
        config: { zoneId: parsed.zoneId, zoneName: parsed.zoneName },
        secretEncrypted: legacyToken,
      },
    ];
    setSetting(ZONES_KEY, JSON.stringify(migrated));
    return migrated;
  }

  return [];
}

function saveZones(zones: StoredZone[]) {
  setSetting(ZONES_KEY, JSON.stringify(zones));
}

export function listZones(): DnsZone[] {
  return loadZones().map(({ secretEncrypted: _secretEncrypted, ...zone }) => zone);
}

export function getZone(id: string): DnsZone | null {
  const zone = loadZones().find((z) => z.id === id);
  if (!zone) return null;
  const { secretEncrypted: _secretEncrypted, ...rest } = zone;
  return rest;
}

export function addZone(input: {
  provider: DnsProviderType;
  label: string;
  config: Record<string, string>;
  secret: Record<string, string>;
}): DnsZone {
  const zones = loadZones();
  const zone: StoredZone = {
    id: randomUUID(),
    provider: input.provider,
    label: input.label,
    config: input.config,
    secretEncrypted: vaultEncrypt(JSON.stringify(input.secret)),
  };
  zones.push(zone);
  saveZones(zones);
  const { secretEncrypted: _secretEncrypted, ...rest } = zone;
  return rest;
}

export function updateZone(
  id: string,
  input: { label?: string; config?: Record<string, string>; secret?: Record<string, string> }
): void {
  const zones = loadZones();
  const zone = zones.find((z) => z.id === id);
  if (!zone) throw new Error("Zone DNS introuvable.");
  if (input.label !== undefined) zone.label = input.label;
  if (input.config !== undefined) zone.config = input.config;
  if (input.secret !== undefined) zone.secretEncrypted = vaultEncrypt(JSON.stringify(input.secret));
  saveZones(zones);
}

export function deleteZone(id: string): void {
  saveZones(loadZones().filter((z) => z.id !== id));
}

function getClient(id: string): DnsProviderClient {
  const zone = loadZones().find((z) => z.id === id);
  if (!zone) throw new Error("Zone DNS introuvable.");
  const secret = JSON.parse(vaultDecrypt(zone.secretEncrypted)) as Record<string, string>;

  switch (zone.provider) {
    case "cloudflare":
      return createCloudflareClient(zone.config, secret);
    case "ovh":
      return createOvhClient(zone.config, secret);
    case "gandi":
      return createGandiClient(zone.config, secret);
    case "namecheap":
      return createNamecheapClient(zone.config, secret);
  }
}

export function listRecords(zoneId: string) {
  return getClient(zoneId).listRecords();
}

export function createRecord(zoneId: string, input: Parameters<DnsProviderClient["createRecord"]>[0]) {
  return getClient(zoneId).createRecord(input);
}

export function updateRecord(zoneId: string, recordId: string, input: Parameters<DnsProviderClient["updateRecord"]>[1]) {
  return getClient(zoneId).updateRecord(recordId, input);
}

export function deleteRecord(zoneId: string, recordId: string) {
  return getClient(zoneId).deleteRecord(recordId);
}

export async function testZoneConnection(zoneId: string): Promise<void> {
  await getClient(zoneId).listRecords();
}
