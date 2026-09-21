import { randomUUID } from "crypto";
import { getDb } from "../db";
import { runSshCommand, shellQuote } from "../ssh";
import { rsyncTransfer, removeRemotePath } from "./transfer";
import { joinRemote, parentOf } from "./engine";
import { getPlan } from "./plans";
import { getLatestRun } from "./runs";

export type RestoreDrillStatus = "running" | "success" | "failed";

export type RestoreDrill = {
  id: string;
  planId: string;
  status: RestoreDrillStatus;
  filesExpected: number | null;
  filesRestored: number | null;
  log: string;
  startedAt: string;
  finishedAt: string | null;
};

type DrillRow = {
  id: string;
  plan_id: string;
  status: RestoreDrillStatus;
  files_expected: number | null;
  files_restored: number | null;
  log: string;
  started_at: string;
  finished_at: string | null;
};

function rowToDrill(row: DrillRow): RestoreDrill {
  return {
    id: row.id,
    planId: row.plan_id,
    status: row.status,
    filesExpected: row.files_expected,
    filesRestored: row.files_restored,
    log: row.log,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function startDrill(planId: string): string {
  const id = randomUUID();
  getDb().prepare(`INSERT INTO restore_drills (id, plan_id, status, log) VALUES (?, ?, 'running', '')`).run(id, planId);
  return id;
}

function appendLog(id: string, text: string): void {
  if (!text) return;
  getDb().prepare(`UPDATE restore_drills SET log = log || ? WHERE id = ?`).run(text, id);
}

function finishDrill(id: string, status: "success" | "failed", filesExpected: number | null, filesRestored: number | null): void {
  getDb()
    .prepare(`UPDATE restore_drills SET status = ?, files_expected = ?, files_restored = ?, finished_at = datetime('now') WHERE id = ?`)
    .run(status, filesExpected, filesRestored, id);
}

export function getDrill(id: string): RestoreDrill | null {
  const row = getDb().prepare(`SELECT * FROM restore_drills WHERE id = ?`).get(id) as DrillRow | undefined;
  return row ? rowToDrill(row) : null;
}

export function getLatestDrill(planId: string): RestoreDrill | null {
  const row = getDb()
    .prepare(`SELECT * FROM restore_drills WHERE plan_id = ? ORDER BY started_at DESC LIMIT 1`)
    .get(planId) as DrillRow | undefined;
  return row ? rowToDrill(row) : null;
}

async function countFiles(hostId: number, dirPath: string): Promise<number> {
  const { stdout, code } = await runSshCommand(hostId, `find ${shellQuote(dirPath)} -type f 2>/dev/null | wc -l`, {
    sudo: true,
    timeoutMs: 15_000,
  });
  if (code !== 0) return 0;
  return parseInt(stdout.trim(), 10) || 0;
}

/**
 * Restores a plan's latest snapshot into a disposable scratch directory on its own source host —
 * never touching the real paths — counts how many files actually came back, compares that against
 * how many files the snapshot itself holds, then deletes the scratch copy. Proves the backup is
 * really restorable (a corrupted archive, a silently truncated transfer, wrong permissions...),
 * not just that the last backup run reported success, which only proves the copy step worked.
 *
 * Restores back onto the same source host on purpose — this drill checks the snapshot's own
 * integrity, not whether the setup survives that machine being gone entirely. For that, use
 * "Renaissance ailleurs" (lib/backup/resurrect.ts) instead, onto a different machine.
 */
export function runRestoreDrill(planId: string): string {
  const plan = getPlan(planId);
  if (!plan) throw new Error("Plan de sauvegarde introuvable.");
  const run = getLatestRun(planId);
  if (!run || run.status !== "success" || !run.snapshotPath) {
    throw new Error("Aucune sauvegarde réussie disponible pour ce plan.");
  }

  const jobId = startDrill(planId);
  const append = (text: string) => appendLog(jobId, text);
  const scratchDir = `/tmp/homelab-panel-drill-${jobId}`;

  (async () => {
    try {
      append(`Drill de restauration pour "${plan.name}" — restauration de test dans ${scratchDir}...\n`);

      let filesExpected = 0;
      for (const raw of run.paths) {
        const clean = raw.replace(/\/+$/, "");
        if (!clean) continue;
        filesExpected += await countFiles(plan.destHostId, joinRemote(run.snapshotPath!, clean));
      }

      for (const raw of run.paths) {
        const clean = raw.replace(/\/+$/, "");
        if (!clean) continue;
        const destDir = joinRemote(scratchDir, parentOf(clean));
        await rsyncTransfer({
          fromHostId: plan.destHostId,
          toHostId: plan.sourceHostId,
          sourcePath: joinRemote(run.snapshotPath!, clean),
          destDir,
          append,
        });
      }

      const filesRestored = await countFiles(plan.sourceHostId, scratchDir);
      append(`\n${filesRestored} fichier(s) restauré(s) sur ${filesExpected} attendu(s) dans le snapshot.\n`);

      await removeRemotePath(plan.sourceHostId, scratchDir);
      append(`Dossier de test nettoyé.\n`);

      const ok = filesExpected === 0 ? filesRestored > 0 : filesRestored >= filesExpected;
      append(
        ok
          ? "\nDrill réussi : la sauvegarde est bien restaurable.\n"
          : "\nDrill en échec : moins de fichiers restaurés que prévu — la sauvegarde pourrait être incomplète ou corrompue.\n"
      );
      finishDrill(jobId, ok ? "success" : "failed", filesExpected, filesRestored);
    } catch (err) {
      append(`\nErreur : ${err instanceof Error ? err.message : "inconnue"}\n`);
      await removeRemotePath(plan.sourceHostId, scratchDir).catch(() => {});
      finishDrill(jobId, "failed", null, null);
    }
  })();

  return jobId;
}
