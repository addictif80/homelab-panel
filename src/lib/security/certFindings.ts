import { checkAllDomains } from "../certWatch";
import { listIgnoredKeys } from "./ignore";
import type { Finding, HostScanResult } from "./types";

/** Not a real host id — this groups certificate findings under their own card in the Security
 * Center, since a watched domain isn't tied to any one machine (it might be reverse-proxied
 * through any of them). */
export const CERT_WATCH_HOST_ID = -1;

const CRITICAL_DAYS = 7;
const WARNING_DAYS = 30;

export async function scanCertificates(): Promise<HostScanResult> {
  const statuses = await checkAllDomains();
  const ignoredKeys = listIgnoredKeys();
  const findings: Finding[] = [];

  for (const s of statuses) {
    let finding: Finding | null = null;
    if (s.error) {
      finding = {
        id: `cert-${s.id}`,
        category: "network",
        severity: "warning",
        title: `Impossible de vérifier le certificat de ${s.domain}`,
        detail: `Connexion TLS échouée sur ${s.domain}:${s.port} — ${s.error}`,
      };
    } else if (s.daysRemaining !== null && s.daysRemaining < CRITICAL_DAYS) {
      finding = {
        id: `cert-${s.id}`,
        category: "network",
        severity: "critical",
        title: `Certificat de ${s.domain} expire dans ${s.daysRemaining} jour${s.daysRemaining > 1 ? "s" : ""}`,
        detail: `Passé cette date, les visiteurs verront un avertissement de sécurité (ou la connexion sera bloquée). Vérifie le renouvellement automatique (Let's Encrypt/certbot, AutoSSL...) sur la machine qui sert ce domaine.`,
      };
    } else if (s.daysRemaining !== null && s.daysRemaining < WARNING_DAYS) {
      finding = {
        id: `cert-${s.id}`,
        category: "network",
        severity: "warning",
        title: `Certificat de ${s.domain} expire dans ${s.daysRemaining} jours`,
        detail: `Encore du temps, mais vérifie que le renouvellement automatique est bien configuré pour ce domaine.`,
      };
    }
    if (finding) {
      findings.push(ignoredKeys.has(`${CERT_WATCH_HOST_ID}:${finding.id}`) ? { ...finding, ignored: true } : finding);
    }
  }

  return {
    hostId: CERT_WATCH_HOST_ID,
    hostName: "Certificats SSL surveillés",
    hostKind: "monitoring",
    hostOs: null,
    findings,
  };
}
