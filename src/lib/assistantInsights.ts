import { getSetting, setSetting } from "./db";
import { isOllamaConfigured, askOllama } from "./ollama";
import { checkRule321 } from "./backup/rule321";
import { getOutageSummary } from "./isp/report";
import { getPowerCostSummary } from "./power/cost";
import { listPlans } from "./backup/plans";
import { getLatestRun } from "./backup/runs";

const INSIGHT_KEY = "assistant_proactive_insight";
const INSIGHT_AT_KEY = "assistant_proactive_insight_at";

/** Everything the digest is built from is already computed, DB-only data — no SSH, no live scan
 * — so refreshing this on a schedule never hammers the fleet the way a security scan would. */
function buildDigest(): string {
  const rule321 = checkRule321();
  const nonCompliant = rule321.filter((r) => !r.compliant);
  const outages = getOutageSummary(30);
  const power = getPowerCostSummary();
  const failedPlans = listPlans()
    .map((p) => ({ name: p.name, run: getLatestRun(p.id) }))
    .filter((p) => p.run?.status === "failed");

  const lines: string[] = [];
  lines.push(`Machines sauvegardées : ${rule321.length}, dont ${nonCompliant.length} non conformes à la règle 3-2-1 des sauvegardes.`);
  for (const nc of nonCompliant) lines.push(`- ${nc.hostName} : ${nc.reasons.join(" ")}`);
  lines.push(
    `Plans de sauvegarde en échec à leur dernier run : ${failedPlans.length}${
      failedPlans.length > 0 ? ` (${failedPlans.map((f) => f.name).join(", ")})` : ""
    }.`
  );
  lines.push(
    `Coupures internet détectées sur les 30 derniers jours : ${outages.totalOutages}${
      outages.ongoing ? " (une coupure est en cours actuellement)" : ""
    }.`
  );
  lines.push(
    `Coût électrique estimé de l'infra : ${power.totalMonthlyCost.toFixed(0)} €/mois${
      power.unconfiguredHostNames.length > 0 ? ` (consommation non renseignée pour ${power.unconfiguredHostNames.length} machine(s))` : ""
    }.`
  );
  return lines.join("\n");
}

export type ProactiveInsight = { message: string; generatedAt: string };

export function getProactiveInsight(): ProactiveInsight | null {
  const message = getSetting(INSIGHT_KEY);
  const generatedAt = getSetting(INSIGHT_AT_KEY);
  return message && generatedAt ? { message, generatedAt } : null;
}

/**
 * Generates one short, unprompted observation about the current state of the homelab — the
 * assistant speaking first, not answering a question — from a digest of data the panel already
 * has (never a live scan). Silently does nothing if the AI isn't configured, since this always
 * runs in the background rather than in response to a click.
 */
export async function refreshProactiveInsight(): Promise<void> {
  if (!isOllamaConfigured()) return;
  const digest = buildDigest();
  const prompt = `Instantané actuel de l'état d'un homelab administré via ce panel :\n${digest}\n\nÉcris, en 2 à 4 phrases maximum et en français, un message proactif comme si tu interpellais l'administrateur en premier — pas une réponse à une question posée, une remarque spontanée sur ce qui mérite le plus son attention en ce moment (ou une note brève et positive s'il n'y a vraiment rien à signaler). Ne liste pas mécaniquement chaque donnée : choisis ce qui compte le plus. Pas de formule d'ouverture type "Bonjour" ou "Salut" — va directement au message.`;
  try {
    const message = await askOllama(prompt);
    if (message.trim()) {
      setSetting(INSIGHT_KEY, message.trim());
      setSetting(INSIGHT_AT_KEY, new Date().toISOString().slice(0, 19).replace("T", " "));
    }
  } catch {
    // Best-effort — a failed generation just leaves the previous insight (or none) in place;
    // this scheduler never surfaces an error to anyone, since nobody asked it to run.
  }
}

// An opinion on the state of the homelab doesn't need to be fresher than this, and each refresh
// calls the user's own configured LLM — no reason to do that more often than a few times a day.
const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;

export function startAssistantInsightScheduler(): void {
  refreshProactiveInsight().catch(() => {});
  setInterval(() => {
    refreshProactiveInsight().catch(() => {});
  }, REFRESH_INTERVAL_MS);
}
