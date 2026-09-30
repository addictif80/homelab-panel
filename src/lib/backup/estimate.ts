import { runSshCommand, shellQuote } from "../ssh";
import type { BackupPlan } from "./plans";
import { listRuns } from "./runs";
import { resolveDockerPaths, type DockerBackupConfig } from "./sources/docker";

export type BackupEstimate = {
  /** Total bytes the configured source currently occupies, or null when this source type can't be
   * sized ahead of a run (database/Proxmox VM/panel config/mailbox — see the switch below). */
  totalBytes: number | null;
  /** Bytes/sec used for the estimate: the plan's own --bwlimit when set (a hard, known cap), or an
   * average pulled from this plan's own past runs (rsync's --stats line in each run's log) when
   * not — actual measured throughput for this exact source/destination pair beats guessing at
   * network speed from scratch. Null when neither is available yet (a brand new, unthrottled
   * plan with no successful run so far). */
  effectiveRateBytesPerSec: number | null;
  rateSource: "bwlimit" | "history" | "unknown";
  estimatedSeconds: number | null;
  /** Human-readable reason estimatedSeconds is null, for the UI to show instead of a number. */
  note: string | null;
};

const DU_TIMEOUT_MS = 60_000;

async function pathSizeBytes(hostId: number, path: string): Promise<number> {
  // `du -sb` walks the whole tree (metadata only, not a read of file contents — much cheaper than
  // the actual backup, but still real disk activity on a source that may already be struggling,
  // which is exactly why this whole feature is an explicit on-demand action rather than something
  // run automatically for every plan on every page load.
  const { stdout, code } = await runSshCommand(hostId, `du -sb ${shellQuote(path)} 2>/dev/null | cut -f1`, {
    sudo: true,
    timeoutMs: DU_TIMEOUT_MS,
  });
  if (code !== 0) return 0;
  const n = Number(stdout.trim());
  return Number.isFinite(n) ? n : 0;
}

/** Parses every rsync --stats summary line in a run's log (one per path backed up) and returns
 * each reported bytes/sec — rsync prints e.g. "sent 1,234,567 bytes  received 890 bytes  " +
 * "12,345.67 bytes/sec" once per invocation, and --info=progress2 output in the same log doesn't
 * match this pattern, so this only ever picks up the real summary lines. */
function parseThroughputSamples(log: string): number[] {
  const matches = log.matchAll(/sent [\d,]+ bytes\s+received [\d,]+ bytes\s+([\d,.]+) bytes\/sec/g);
  return [...matches].map((m) => Number(m[1].replace(/,/g, ""))).filter((n) => Number.isFinite(n) && n > 0);
}

function averageHistoricalRate(planId: string): number | null {
  const samples = listRuns(planId, 5)
    .filter((r) => r.status === "success")
    .flatMap((r) => parseThroughputSamples(r.log));
  if (samples.length === 0) return null;
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

/** Sizes the configured source ahead of a run, for source types that resolve to plain filesystem
 * paths — 'database'/'proxmox_vm'/'panel_config'/'mailbox' don't have a cheap equivalent (an
 * accurate size would mean actually dumping the database or listing every mailbox's storage,
 * real work in itself) and are reported as non-estimable rather than guessed at. */
async function resolveSourceBytes(plan: BackupPlan): Promise<{ bytes: number | null; note: string | null }> {
  if (plan.sourceType === "paths") {
    const { paths } = JSON.parse(plan.sourceConfig) as { paths: string[] };
    let total = 0;
    for (const p of paths) total += await pathSizeBytes(plan.sourceHostId, p);
    return { bytes: total, note: null };
  }
  if (plan.sourceType === "docker") {
    const cfg = JSON.parse(plan.sourceConfig) as DockerBackupConfig;
    const noop = () => {};
    const { paths, cleanup } = await resolveDockerPaths(plan.sourceHostId, cfg, noop);
    let total = 0;
    for (const p of paths) total += await pathSizeBytes(plan.sourceHostId, p);
    await runSshCommand(plan.sourceHostId, cleanup, { sudo: true }).catch(() => {});
    return { bytes: total, note: null };
  }
  return {
    bytes: null,
    note: "Ce type de source ne peut pas être mesuré à l'avance (il faudrait effectuer une partie du travail de sauvegarde lui-même) — l'estimation se base uniquement sur l'historique des runs précédents, s'il y en a.",
  };
}

export async function estimateBackupDuration(plan: BackupPlan): Promise<BackupEstimate> {
  const { bytes: totalBytes, note: sizeNote } = await resolveSourceBytes(plan);

  let rate: number | null = null;
  let rateSource: BackupEstimate["rateSource"] = "unknown";
  if (plan.bwlimitKbps) {
    rate = plan.bwlimitKbps * 1024;
    rateSource = "bwlimit";
  } else {
    const historical = averageHistoricalRate(plan.id);
    if (historical) {
      rate = historical;
      rateSource = "history";
    }
  }

  let estimatedSeconds: number | null = null;
  let note: string | null = sizeNote;
  if (totalBytes !== null && rate) {
    estimatedSeconds = totalBytes / rate;
  } else if (!note) {
    note =
      rate === null
        ? "Pas de limite de bande passante définie et aucun run réussi précédent à mesurer — lance une première sauvegarde (même sans limite) pour obtenir un historique, ou définis une limite pour avoir un plancher garanti."
        : "Taille de la source non déterminée.";
  }

  return { totalBytes, effectiveRateBytesPerSec: rate, rateSource, estimatedSeconds, note };
}
