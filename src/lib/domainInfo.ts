import { randomUUID } from "crypto";
import { getSetting, setSetting } from "./db";

export type WatchedRegDomain = { id: string; domain: string };

export type DomainRegInfo = {
  id: string;
  domain: string;
  registrar: string | null;
  registeredAt: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  error: string | null;
};

const KEY = "watched_reg_domains";
const LOOKUP_TIMEOUT_MS = 10_000;

export function listWatchedRegDomains(): WatchedRegDomain[] {
  const raw = getSetting(KEY);
  return raw ? JSON.parse(raw) : [];
}

function saveDomains(domains: WatchedRegDomain[]) {
  setSetting(KEY, JSON.stringify(domains));
}

export function addWatchedRegDomain(domain: string): WatchedRegDomain {
  const domains = listWatchedRegDomains();
  const created: WatchedRegDomain = { id: randomUUID(), domain: domain.trim().toLowerCase() };
  domains.push(created);
  saveDomains(domains);
  return created;
}

export function removeWatchedRegDomain(id: string): void {
  saveDomains(listWatchedRegDomains().filter((d) => d.id !== id));
}

type RdapEvent = { eventAction: string; eventDate: string };
type RdapEntity = { roles?: string[]; vcardArray?: [string, unknown[]]; handle?: string };
type RdapResponse = { events?: RdapEvent[]; entities?: RdapEntity[]; status?: string[] };

function entityName(entity: RdapEntity): string | null {
  // vCard array format: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Registrar Name"], ...]]
  const fields = entity.vcardArray?.[1] as unknown[] | undefined;
  if (!Array.isArray(fields)) return entity.handle ?? null;
  const fn = fields.find((f) => Array.isArray(f) && f[0] === "fn") as [string, unknown, string, string] | undefined;
  return fn?.[3] ?? entity.handle ?? null;
}

/**
 * RDAP (the modern, structured successor to WHOIS) via the IANA-run bootstrap redirector at
 * rdap.org — works for essentially any TLD with no registrar-specific credentials, unlike the
 * DNS provider integrations elsewhere in this app (those manage records for domains *you* already
 * host with them; this looks up registration facts for *any* domain name, regardless of who it's
 * registered or hosted with).
 */
async function lookupOne(entry: WatchedRegDomain): Promise<DomainRegInfo> {
  const base: DomainRegInfo = {
    id: entry.id,
    domain: entry.domain,
    registrar: null,
    registeredAt: null,
    expiresAt: null,
    daysRemaining: null,
    error: null,
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(entry.domain)}`, {
      signal: controller.signal,
      headers: { Accept: "application/rdap+json" },
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { ...base, error: res.status === 404 ? "Domaine introuvable (peut-être expiré ou jamais enregistré)." : `Erreur RDAP (HTTP ${res.status}).` };
    }
    const data = (await res.json()) as RdapResponse;

    const expiration = data.events?.find((e) => e.eventAction === "expiration");
    const registration = data.events?.find((e) => e.eventAction === "registration");
    const registrarEntity = data.entities?.find((e) => e.roles?.includes("registrar"));

    const expiresAt = expiration?.eventDate ?? null;
    const daysRemaining = expiresAt ? Math.floor((new Date(expiresAt).getTime() - Date.now()) / 86_400_000) : null;

    return {
      ...base,
      registrar: registrarEntity ? entityName(registrarEntity) : null,
      registeredAt: registration?.eventDate ?? null,
      expiresAt,
      daysRemaining,
    };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : "Erreur de connexion RDAP." };
  }
}

export async function checkAllRegDomains(): Promise<DomainRegInfo[]> {
  return Promise.all(listWatchedRegDomains().map(lookupOne));
}

export async function lookupDomainOnce(domain: string): Promise<DomainRegInfo> {
  return lookupOne({ id: "preview", domain: domain.trim().toLowerCase() });
}
