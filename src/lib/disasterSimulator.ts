import { getDb } from "./db";

export type SimulationStep = {
  id: string;
  title: string;
  status: "ok" | "warning" | "critical";
  detail: string;
};

type HostRow = { id: number; name: string; kind: string; role: string | null };
type BackupPlanRow = { id: string; name: string; schedule: string; retention_count: number; dest_host_name: string };
type LastRunRow = { status: string; started_at: string; snapshot_path: string | null };

const SCHEDULE_HOURS: Record<string, number> = { hourly: 1, daily: 24, weekly: 24 * 7 };

function getHost(hostId: number): HostRow {
  const host = getDb().prepare(`SELECT id, name, kind, role FROM hosts WHERE id = ?`).get(hostId) as HostRow | undefined;
  if (!host) throw new Error("Machine introuvable.");
  return host;
}

function getDependents(hostId: number): HostRow[] {
  return getDb()
    .prepare(`SELECT id, name, kind, role FROM hosts WHERE parent_host_id = ?`)
    .all(hostId) as HostRow[];
}

function getBackupPlans(hostId: number): (BackupPlanRow & { lastRun: LastRunRow | null })[] {
  const plans = getDb()
    .prepare(
      `SELECT p.id, p.name, p.schedule, p.retention_count, d.name as dest_host_name
       FROM backup_plans p JOIN hosts d ON d.id = p.dest_host_id
       WHERE p.source_host_id = ? AND p.enabled = 1`
    )
    .all(hostId) as BackupPlanRow[];

  return plans.map((p) => {
    const lastRun = getDb()
      .prepare(
        `SELECT status, started_at, snapshot_path FROM backup_runs WHERE plan_id = ? AND status = 'success' ORDER BY started_at DESC LIMIT 1`
      )
      .get(p.id) as LastRunRow | undefined;
    return { ...p, lastRun: lastRun ?? null };
  });
}

function ageDescription(startedAt: string): { hours: number; text: string } {
  const hours = (Date.now() - new Date(`${startedAt}Z`).getTime()) / 3_600_000;
  if (hours < 1) return { hours, text: "il y a moins d'une heure" };
  if (hours < 24) return { hours, text: `il y a ${Math.round(hours)} h` };
  return { hours, text: `il y a ${Math.round(hours / 24)} j` };
}

/**
 * Walks through "this machine dies right now" step by step, using only what's actually on file —
 * real backup runs, real dependents, real schedules. Never invents a recovery time estimate from
 * nothing: without a measured throughput or a known data size, a made-up ETA would be worse than
 * no ETA, so this reports readiness (backed up or not, how stale, what else breaks with it)
 * rather than a false-precision countdown.
 */
export function simulateDisaster(hostId: number): SimulationStep[] {
  const host = getHost(hostId);
  const steps: SimulationStep[] = [];

  steps.push({
    id: "start",
    title: `${host.name} tombe en panne, maintenant`,
    status: "critical",
    detail: `Panne totale simulée sur ${host.name}${host.role ? ` (${host.role})` : ""}. Voici ce qui se passerait réellement, d'après l'état actuel du panel.`,
  });

  const dependents = getDependents(hostId);
  if (dependents.length > 0) {
    steps.push({
      id: "dependents",
      title: `${dependents.length} machine${dependents.length > 1 ? "s" : ""} hébergée${dependents.length > 1 ? "s" : ""} tombe${dependents.length > 1 ? "nt" : ""} avec elle`,
      status: "critical",
      detail: `${dependents.map((d) => d.name).join(", ")} — ${dependents.length > 1 ? "sont déclarées" : "est déclarée"} comme hébergée${dependents.length > 1 ? "s" : ""} sur ${host.name} dans l'inventaire. Pas de panne isolée : c'est un effet domino.`,
    });
  } else {
    steps.push({
      id: "dependents",
      title: "Aucune autre machine n'en dépend directement",
      status: "ok",
      detail: `D'après l'inventaire, aucune VM/LXC n'est déclarée comme hébergée sur ${host.name} — la casse reste a priori limitée à cette machine.`,
    });
  }

  const plans = getBackupPlans(hostId);
  if (plans.length === 0) {
    steps.push({
      id: "backups",
      title: "Aucun plan de sauvegarde configuré pour cette machine",
      status: "critical",
      detail: `${host.name} n'est source d'aucun plan de sauvegarde actif. En cas de panne réelle, tout ce qui n'est sauvegardé nulle part ailleurs est perdu.`,
    });
  } else {
    for (const plan of plans) {
      if (!plan.lastRun) {
        steps.push({
          id: `plan-${plan.id}`,
          title: `"${plan.name}" n'a jamais réussi`,
          status: "critical",
          detail: `Ce plan existe mais n'a aucune sauvegarde réussie enregistrée vers ${plan.dest_host_name}. En l'état, il ne protège rien.`,
        });
        continue;
      }
      const { hours, text } = ageDescription(plan.lastRun.started_at);
      const expectedHours = SCHEDULE_HOURS[plan.schedule];
      const stale = expectedHours ? hours > expectedHours * 2 : false;
      steps.push({
        id: `plan-${plan.id}`,
        title: `"${plan.name}" → ${plan.dest_host_name} : dernière sauvegarde réussie ${text}`,
        status: stale ? "warning" : "ok",
        detail: stale
          ? `Planifié en "${plan.schedule}", mais la dernière réussite remonte à plus longtemps que prévu. En cas de panne maintenant, tu perdrais tout ce qui a changé depuis ${text} — vérifie pourquoi les runs récents n'ont pas abouti.`
          : `Snapshot le plus récent : ${plan.lastRun.snapshot_path ?? "chemin non enregistré"}. Conserve ${plan.retention_count} version${plan.retention_count > 1 ? "s" : ""} sur ${plan.dest_host_name}.`,
      });
    }
  }

  const criticalCount = steps.filter((s) => s.status === "critical").length;
  steps.push({
    id: "verdict",
    title: criticalCount > 1 ? "Verdict : reprise incertaine" : criticalCount === 1 ? "Verdict : reprise possible, mais pas indolore" : "Verdict : reprise raisonnablement sûre",
    status: criticalCount > 1 ? "critical" : criticalCount === 1 ? "warning" : "ok",
    detail:
      criticalCount > 1
        ? "Plusieurs points bloquants ci-dessus. Avant de considérer cette machine \"couverte\", règle-les un par un — en commençant par celui qui te ferait perdre le plus."
        : criticalCount === 1
          ? "Un point à corriger avant que cette machine soit vraiment couverte contre une panne."
          : "Sur la base des données du panel, une panne de cette machine serait gênante mais récupérable : dépendances identifiées, sauvegardes à jour.",
  });

  return steps;
}
