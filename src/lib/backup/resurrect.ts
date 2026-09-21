import { randomUUID } from "crypto";
import { getDb } from "../db";
import { runSshCommand, shellQuote } from "../ssh";
import { rsyncTransfer } from "./transfer";
import { joinRemote, parentOf } from "./engine";
import { getPlan, listPlans, type BackupPlan } from "./plans";
import { getLatestRun, type BackupRun } from "./runs";

export type ResurrectionKind = "single" | "clone";
export type ResurrectionStatus = "running" | "success" | "failed";

export type Resurrection = {
  id: string;
  kind: ResurrectionKind;
  planId: string | null;
  targetHostId: number;
  status: ResurrectionStatus;
  log: string;
  startedAt: string;
  finishedAt: string | null;
};

type ResurrectionRow = {
  id: string;
  kind: ResurrectionKind;
  plan_id: string | null;
  target_host_id: number;
  status: ResurrectionStatus;
  log: string;
  started_at: string;
  finished_at: string | null;
};

function rowToResurrection(row: ResurrectionRow): Resurrection {
  return {
    id: row.id,
    kind: row.kind,
    planId: row.plan_id,
    targetHostId: row.target_host_id,
    status: row.status,
    log: row.log,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function startJob(kind: ResurrectionKind, planId: string | null, targetHostId: number): string {
  const id = randomUUID();
  getDb()
    .prepare(`INSERT INTO service_resurrections (id, kind, plan_id, target_host_id, status, log) VALUES (?, ?, ?, ?, 'running', '')`)
    .run(id, kind, planId, targetHostId);
  return id;
}

function appendLog(id: string, text: string): void {
  if (!text) return;
  getDb().prepare(`UPDATE service_resurrections SET log = log || ? WHERE id = ?`).run(text, id);
}

function finishJob(id: string, status: "success" | "failed"): void {
  getDb().prepare(`UPDATE service_resurrections SET status = ?, finished_at = datetime('now') WHERE id = ?`).run(status, id);
}

export function getResurrection(id: string): Resurrection | null {
  const row = getDb().prepare(`SELECT * FROM service_resurrections WHERE id = ?`).get(id) as ResurrectionRow | undefined;
  return row ? rowToResurrection(row) : null;
}

/** Pulls every backed-up path of a run back down onto the target host, at the same absolute
 * location it was captured from — the same mechanism as a single-path restore (see restore.ts),
 * just looped over the whole run instead of one path at a time. */
async function restoreAllPaths(
  backupHostId: number,
  snapshotDir: string,
  paths: string[],
  targetHostId: number,
  append: (text: string) => void
): Promise<void> {
  for (const raw of paths) {
    const clean = raw.replace(/\/+$/, "");
    if (!clean) continue;
    const parent = parentOf(clean);
    const sourceOnBackup = joinRemote(snapshotDir, clean);
    await rsyncTransfer({ fromHostId: backupHostId, toHostId: targetHostId, sourcePath: sourceOnBackup, destDir: parent, append });
  }
}

type DockerInspectMount = { Type: string; Name?: string; Source: string; Destination: string };
type DockerInspect = {
  Name: string;
  Config: { Image: string; Env: string[] | null; Cmd: string[] | null };
  HostConfig: { RestartPolicy?: { Name: string }; PortBindings: Record<string, { HostPort: string }[] | null> | null };
  Mounts: DockerInspectMount[];
};

/**
 * Recreates one container on the target host from the `docker inspect` dump saved alongside its
 * volumes (see sources/docker.ts) — image, env, published ports and restart policy are carried
 * over. Volumes are re-attached as bind mounts pointing straight at the path the data was just
 * restored to (same absolute path as the original), not recreated as "real" named Docker volumes
 * — `docker volume ls` on the new machine won't list them, but the container reads/writes the
 * exact same data, which is what matters for a service coming back up.
 */
async function recreateDockerContainer(targetHostId: number, inspectPath: string, append: (text: string) => void): Promise<void> {
  const { stdout, code } = await runSshCommand(targetHostId, `cat ${shellQuote(inspectPath)}`, { sudo: true });
  if (code !== 0) throw new Error(`Impossible de lire ${inspectPath} sur la nouvelle machine.`);

  const parsed = JSON.parse(stdout) as DockerInspect[] | DockerInspect;
  const info = Array.isArray(parsed) ? parsed[0] : parsed;
  const name = info.Name.replace(/^\//, "");
  const volumeMounts = (info.Mounts ?? []).filter((m) => m.Type === "volume");

  const args = ["-d", "--name", shellQuote(name)];
  if (info.HostConfig?.RestartPolicy?.Name && info.HostConfig.RestartPolicy.Name !== "no") {
    args.push("--restart", shellQuote(info.HostConfig.RestartPolicy.Name));
  }
  for (const env of info.Config?.Env ?? []) args.push("-e", shellQuote(env));
  for (const [containerPort, bindings] of Object.entries(info.HostConfig?.PortBindings ?? {})) {
    for (const b of bindings ?? []) args.push("-p", shellQuote(`${b.HostPort}:${containerPort.split("/")[0]}`));
  }
  for (const m of volumeMounts) args.push("-v", shellQuote(`${m.Source}:${m.Destination}`));

  append(`Recréation du conteneur "${name}" (${info.Config.Image}) sur la nouvelle machine...\n`);
  const command = `docker rm -f ${shellQuote(name)} >/dev/null 2>&1; docker run ${args.join(" ")} ${shellQuote(info.Config.Image)}`;
  const res = await runSshCommand(targetHostId, command, { sudo: true });
  if (res.code !== 0) throw new Error(res.stderr || `Impossible de relancer le conteneur "${name}".`);
  append(`Conteneur "${name}" relancé.\n`);
}

/** Restores one plan's latest successful backup onto targetHostId, and — for a Docker source —
 * relaunches every container it covered. Other source types get their files restored but need a
 * manual final step the panel deliberately doesn't guess at (see the notes below): auto-importing
 * a database dump or a Proxmox archive risks silently overwriting something already running on
 * the target, which a plain file restore never does. */
async function resurrectOnePlan(plan: BackupPlan, run: BackupRun, targetHostId: number, append: (text: string) => void): Promise<void> {
  append(`Restauration des données de "${plan.name}" vers la nouvelle machine...\n`);
  await restoreAllPaths(plan.destHostId, run.snapshotPath!, run.paths, targetHostId, append);

  if (plan.sourceType === "docker") {
    const cfg = JSON.parse(plan.sourceConfig) as { containerIds: string[] };
    for (const containerId of cfg.containerIds) {
      const inspectPath = run.paths.find((p) => p.includes(`homelab-panel-inspect-${containerId}`));
      if (!inspectPath) {
        append(`Pas de sauvegarde "docker inspect" pour ${containerId} — fichiers restaurés, conteneur non recréé.\n`);
        continue;
      }
      try {
        await recreateDockerContainer(targetHostId, inspectPath, append);
      } catch (err) {
        append(`Erreur en recréant ${containerId} : ${err instanceof Error ? err.message : "inconnue"}\n`);
      }
    }
  } else if (plan.sourceType === "database") {
    append(
      `Dump de base de données restauré tel quel — importe-le avec la commande habituelle de ton moteur ` +
        `(mysql/psql...) : le panel ne l'importe jamais tout seul, pour ne pas écraser une base déjà en place sur la nouvelle machine.\n`
    );
  } else if (plan.sourceType === "proxmox_vm") {
    append(
      `Archive vzdump restaurée telle quelle — importe-la depuis l'interface Proxmox de la nouvelle machine (qmrestore) : ` +
        `la renaissance automatique ne recrée que les services Docker et les dossiers/fichiers.\n`
    );
  }
}

/** "Renaissance d'un service ailleurs" — one plan, its most recent successful backup, replayed
 * onto a chosen machine. */
export function resurrectPlan(planId: string, targetHostId: number): string {
  const plan = getPlan(planId);
  if (!plan) throw new Error("Plan de sauvegarde introuvable.");
  const run = getLatestRun(planId);
  if (!run || run.status !== "success" || !run.snapshotPath) {
    throw new Error("Aucune sauvegarde réussie disponible pour ce plan.");
  }

  const jobId = startJob("single", planId, targetHostId);
  const append = (text: string) => appendLog(jobId, text);

  (async () => {
    try {
      await resurrectOnePlan(plan, run, targetHostId, append);
      append(`\nRenaissance terminée.\n`);
      finishJob(jobId, "success");
    } catch (err) {
      append(`\nErreur : ${err instanceof Error ? err.message : "inconnue"}\n`);
      finishJob(jobId, "failed");
    }
  })();

  return jobId;
}

/** "Cloner tout ton setup vers une machine neuve" — every backup plan sourced from one host,
 * replayed onto a fresh machine in sequence. Built entirely on top of resurrectOnePlan: this is
 * genuinely just "renaissance, looped" — not a separate mechanism, and not a claim of cloning the
 * OS itself (packages, users, system config outside what a "Configuration du panel" or "Dossiers"
 * plan explicitly covers aren't touched). */
export function cloneHostToNewMachine(sourceHostId: number, targetHostId: number): string {
  const plans = listPlans().filter((p) => p.sourceHostId === sourceHostId);
  if (plans.length === 0) {
    throw new Error("Aucun plan de sauvegarde n'existe pour cette machine — il faut au moins une sauvegarde réussie pour pouvoir la cloner.");
  }

  const jobId = startJob("clone", null, targetHostId);
  const append = (text: string) => appendLog(jobId, text);

  (async () => {
    try {
      append(`Clonage de ${plans.length} plan(s) de sauvegarde vers la nouvelle machine...\n`);
      let cloned = 0;
      for (const plan of plans) {
        const run = getLatestRun(plan.id);
        append(`\n--- ${plan.name} ---\n`);
        if (!run || run.status !== "success" || !run.snapshotPath) {
          append(`Aucune sauvegarde réussie disponible, ignoré.\n`);
          continue;
        }
        await resurrectOnePlan(plan, run, targetHostId, append);
        cloned++;
      }
      append(`\nClonage terminé : ${cloned}/${plans.length} plan(s) restauré(s) sur la nouvelle machine.\n`);
      finishJob(jobId, cloned > 0 ? "success" : "failed");
    } catch (err) {
      append(`\nErreur : ${err instanceof Error ? err.message : "inconnue"}\n`);
      finishJob(jobId, "failed");
    }
  })();

  return jobId;
}
