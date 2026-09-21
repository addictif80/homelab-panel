import { getDb } from "../db";
import { listPlans, type BackupPlan } from "./plans";
import { getLatestRun } from "./runs";

export type Rule321Status = {
  hostId: number;
  hostName: string;
  /** 1 (the live data) + one per distinct backup destination with at least one enabled plan. */
  totalCopies: number;
  /** Distinct destination hosts across this source's enabled plans — the "2 media" leg of 3-2-1. */
  distinctDestinations: number;
  hasOffsiteDestination: boolean;
  /** True when the offsite destination exists but its most recent successful run is too old to
   * trust — an offsite copy that stopped running silently is functionally the same as no offsite
   * copy at all. */
  offsiteStale: boolean;
  offsiteLastSuccessAt: string | null;
  compliant: boolean;
  reasons: string[];
};

type HostRow = { id: number; name: string; offsite: number };

/** How long a schedule can go without a successful run before its copy no longer counts as
 * "current" — generous on purpose (a missed run or two shouldn't cry wolf), but well past the
 * point where the schedule itself would have retried on its own. */
const STALE_THRESHOLD_DAYS: Record<BackupPlan["schedule"], number> = {
  hourly: 2,
  daily: 3,
  weekly: 10,
  // A manual plan has no cadence to fall behind on — never flagged stale on its own.
  manual: Infinity,
};

function daysSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000);
}

/** Real verification of the 3-2-1 backup rule (3 copies, on 2 different media, 1 offsite) for
 * every host that has at least one enabled backup plan — not just "a backup ran successfully",
 * but whether the *strategy* around it actually protects against losing the source host entirely.
 * "Offsite" is never inferred from an IP/subnet (self-hosters routinely have two sites on the same
 * private range) — it's the `hosts.offsite` flag the user sets explicitly on the destination. */
export function checkRule321(): Rule321Status[] {
  const db = getDb();
  const hosts = db.prepare(`SELECT id, name, offsite FROM hosts`).all() as HostRow[];
  const hostsById = new Map(hosts.map((h) => [h.id, h]));
  const plans = listPlans().filter((p) => p.enabled);

  const plansBySource = new Map<number, BackupPlan[]>();
  for (const plan of plans) {
    if (!plansBySource.has(plan.sourceHostId)) plansBySource.set(plan.sourceHostId, []);
    plansBySource.get(plan.sourceHostId)!.push(plan);
  }

  const results: Rule321Status[] = [];
  for (const [sourceHostId, sourcePlans] of plansBySource) {
    const sourceHost = hostsById.get(sourceHostId);
    if (!sourceHost) continue;

    const destHostIds = new Set(sourcePlans.map((p) => p.destHostId));
    const offsitePlans = sourcePlans.filter((p) => hostsById.get(p.destHostId)?.offsite);
    const hasOffsiteDestination = offsitePlans.length > 0;

    let offsiteLastSuccessAt: string | null = null;
    let offsiteStale = !hasOffsiteDestination;
    if (hasOffsiteDestination) {
      let mostLenientThreshold = 0;
      for (const plan of offsitePlans) {
        const run = getLatestRun(plan.id);
        if (run?.status === "success" && run.finishedAt) {
          if (!offsiteLastSuccessAt || run.finishedAt > offsiteLastSuccessAt) offsiteLastSuccessAt = run.finishedAt;
        }
        mostLenientThreshold = Math.max(mostLenientThreshold, STALE_THRESHOLD_DAYS[plan.schedule]);
      }
      offsiteStale = !offsiteLastSuccessAt || daysSince(offsiteLastSuccessAt) > mostLenientThreshold;
    }

    const totalCopies = 1 + destHostIds.size;
    const distinctDestinations = destHostIds.size;

    const reasons: string[] = [];
    if (totalCopies < 3) reasons.push(`Seulement ${totalCopies} copie(s) au total (3 recommandées : l'original + 2 sauvegardes).`);
    if (distinctDestinations < 2) reasons.push("Toutes les sauvegardes vont vers la même destination — un seul incident sur cette machine les emporterait toutes.");
    if (!hasOffsiteDestination) reasons.push("Aucune destination marquée « site distant » — en cas de sinistre sur place (incendie, vol), toutes les copies seraient perdues.");
    else if (offsiteStale) {
      reasons.push(
        offsiteLastSuccessAt
          ? `La copie hors-site n'a pas réussi depuis ${Math.floor(daysSince(offsiteLastSuccessAt))} jours.`
          : "La copie hors-site n'a jamais réussi."
      );
    }

    results.push({
      hostId: sourceHostId,
      hostName: sourceHost.name,
      totalCopies,
      distinctDestinations,
      hasOffsiteDestination,
      offsiteStale,
      offsiteLastSuccessAt,
      compliant: reasons.length === 0,
      reasons,
    });
  }

  return results.sort((a, b) => a.hostName.localeCompare(b.hostName));
}
