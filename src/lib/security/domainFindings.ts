import { checkAllRegDomains } from "../domainInfo";
import { listIgnoredKeys } from "./ignore";
import type { Finding, HostScanResult } from "./types";

/** Not a real host id — mirrors CERT_WATCH_HOST_ID (certFindings.ts): a watched domain's
 * *registration* isn't tied to any one machine either, so it gets its own card. */
export const DOMAIN_WATCH_HOST_ID = -2;

const CRITICAL_DAYS = 14;
const WARNING_DAYS = 45;

export async function scanDomainRegistrations(): Promise<HostScanResult> {
  const infos = await checkAllRegDomains();
  const ignoredKeys = listIgnoredKeys();
  const findings: Finding[] = [];

  for (const info of infos) {
    let finding: Finding | null = null;
    if (info.error) {
      finding = {
        id: `domain-${info.id}`,
        category: "network",
        severity: "warning",
        title: `Impossible de vérifier l'enregistrement de ${info.domain}`,
        detail: info.error,
      };
    } else if (info.daysRemaining !== null && info.daysRemaining < CRITICAL_DAYS) {
      finding = {
        id: `domain-${info.id}`,
        category: "network",
        severity: "critical",
        title: `${info.domain} expire dans ${info.daysRemaining} jour${info.daysRemaining > 1 ? "s" : ""}`,
        detail: `Registrar : ${info.registrar ?? "inconnu"}. Passé cette date, le domaine peut être suspendu puis remis en vente publiquement — vérifie le renouvellement automatique chez ton registrar.`,
      };
    } else if (info.daysRemaining !== null && info.daysRemaining < WARNING_DAYS) {
      finding = {
        id: `domain-${info.id}`,
        category: "network",
        severity: "warning",
        title: `${info.domain} expire dans ${info.daysRemaining} jours`,
        detail: `Registrar : ${info.registrar ?? "inconnu"}. Encore du temps, mais vérifie que le renouvellement automatique est activé.`,
      };
    }
    if (finding) {
      findings.push(ignoredKeys.has(`${DOMAIN_WATCH_HOST_ID}:${finding.id}`) ? { ...finding, ignored: true } : finding);
    }
  }

  return {
    hostId: DOMAIN_WATCH_HOST_ID,
    hostName: "Noms de domaine surveillés",
    hostKind: "monitoring",
    hostOs: null,
    findings,
  };
}
