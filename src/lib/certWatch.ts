import { connect } from "tls";
import { randomUUID } from "crypto";
import { getSetting, setSetting } from "./db";

export type WatchedDomain = { id: string; domain: string; port: number };

export type CertStatus = {
  id: string;
  domain: string;
  port: number;
  daysRemaining: number | null;
  validTo: string | null;
  error: string | null;
};

const KEY = "watched_domains";
const CHECK_TIMEOUT_MS = 8000;

export function listWatchedDomains(): WatchedDomain[] {
  const raw = getSetting(KEY);
  return raw ? JSON.parse(raw) : [];
}

function saveDomains(domains: WatchedDomain[]) {
  setSetting(KEY, JSON.stringify(domains));
}

export function addWatchedDomain(domain: string, port = 443): WatchedDomain {
  const domains = listWatchedDomains();
  const created: WatchedDomain = { id: randomUUID(), domain, port };
  domains.push(created);
  saveDomains(domains);
  return created;
}

export function removeWatchedDomain(id: string): void {
  saveDomains(listWatchedDomains().filter((d) => d.id !== id));
}

function checkOne(domain: WatchedDomain): Promise<CertStatus> {
  return new Promise((resolve) => {
    const socket = connect(
      { host: domain.domain, port: domain.port, servername: domain.domain, timeout: CHECK_TIMEOUT_MS },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          socket.end();
          if (!cert || !cert.valid_to) {
            resolve({ ...domain, daysRemaining: null, validTo: null, error: "Certificat introuvable." });
            return;
          }
          const validTo = new Date(cert.valid_to);
          const daysRemaining = Math.floor((validTo.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
          resolve({ ...domain, daysRemaining, validTo: validTo.toISOString(), error: null });
        } catch (err) {
          socket.end();
          resolve({ ...domain, daysRemaining: null, validTo: null, error: err instanceof Error ? err.message : "Erreur." });
        }
      }
    );
    socket.on("error", (err) => resolve({ ...domain, daysRemaining: null, validTo: null, error: err.message }));
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ ...domain, daysRemaining: null, validTo: null, error: "Délai dépassé." });
    });
  });
}

export async function checkAllDomains(): Promise<CertStatus[]> {
  return Promise.all(listWatchedDomains().map(checkOne));
}
