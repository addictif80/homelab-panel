import { runSshCommand, shellQuote } from "../ssh";
import { withTimeout } from "../timeout";
import { listLogSources } from "../logSources";
import { analyzeLogLines, reasonLabel, summarizeGenericErrors } from "../logAnalysis";
import { getDetectionThresholds } from "../logAnalysisSettings";
import type { Finding } from "./types";

const HISTORY_LINES = 5000;
const HISTORY_TIMEOUT_MS = 20_000;

/**
 * Re-analyzes the tail of each log source already configured on this host, independently of
 * whether anyone had the live dashboard view open — catches an attack that started and ended
 * while nobody was watching.
 */
export async function historicalLogFindings(hostId: number): Promise<Finding[]> {
  const sources = listLogSources().filter((s) => s.hostId === hostId);
  if (sources.length === 0) return [];

  const thresholds = getDetectionThresholds();
  const findings: Finding[] = [];

  for (const source of sources) {
    const tailCmd = source.filePath
      ? `docker exec ${shellQuote(source.containerId)} tail -n ${HISTORY_LINES} ${shellQuote(source.filePath)}`
      : `docker logs --tail ${HISTORY_LINES} ${shellQuote(source.containerId)}`;

    let lines: string[];
    try {
      const { stdout } = await withTimeout(
        runSshCommand(hostId, tailCmd, { sudo: true }),
        HISTORY_TIMEOUT_MS,
        "Délai dépassé lors de la relecture des logs."
      );
      lines = stdout.split(/\r?\n/).filter((l) => l.length > 0);
    } catch {
      // A source that's temporarily unreachable shouldn't block the rest of the scan.
      continue;
    }

    const suggestions = analyzeLogLines(lines, thresholds);
    for (const s of suggestions) {
      findings.push({
        id: `log-${source.id}-${s.ip}`,
        category: "network",
        severity: s.reasons.includes("auth_failure") ? "critical" : "warning",
        title: `Adresse suspecte dans les logs "${source.label}" : ${s.ip}`,
        detail: `Repérée en relisant l'historique des logs (pas seulement en direct) : ${s.reasons
          .map(reasonLabel)
          .join(", ")}. Échecs d'auth : ${s.counts.authFailure}, 404 : ${s.counts.notFound}, requêtes totales : ${s.counts.total}.`,
        fixId: "block-ip",
        fixLabel: `Bloquer ${s.ip}`,
        fixParams: { ip: s.ip },
      });
    }

    const errorSummary = summarizeGenericErrors(lines);
    if (errorSummary) {
      findings.push({
        id: `log-errors-${source.id}`,
        category: "diagnostics",
        severity: errorSummary.count >= 100 ? "critical" : "warning",
        title: `Beaucoup d'erreurs dans les logs "${source.label}" (${errorSummary.count})`,
        detail: `Sur les ${HISTORY_LINES} dernières lignes du conteneur "${source.containerName}", ${errorSummary.count} contiennent un mot-clé d'erreur (error, exception, fatal, refused...). Dernier exemple : "${errorSummary.sample}". Action recommandée : ouvrir les logs complets de ce conteneur pour identifier la cause.`,
        howTo: [`docker logs --tail 200 ${source.containerId}`],
      });
    }
  }

  return findings;
}
