import { getDb } from "./db";

export type Incident = {
  id: string;
  type: "host_down" | "backup_failed";
  hostName: string;
  hostId: number;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number;
  detail: string;
};

type PulseRow = { host_id: number; host_name: string; reachable: number; recorded_at: string };

/** Groups consecutive "unreachable" pulse samples into outage windows — pulse_history is sampled
 * every ~15s per host (see lib/pulse.ts), so a run of consecutive reachable=0 rows between two
 * reachable=1 rows (or the present moment, if still down) is one continuous outage. */
function detectHostDownIncidents(days: number): Incident[] {
  const rows = getDb()
    .prepare(
      `SELECT p.host_id, h.name as host_name, p.reachable, p.recorded_at
       FROM pulse_history p JOIN hosts h ON h.id = p.host_id
       WHERE p.recorded_at > datetime('now', ?)
       ORDER BY p.host_id, p.recorded_at ASC`
    )
    .all(`-${days} days`) as PulseRow[];

  const incidents: Incident[] = [];
  let openStart: string | null = null;
  let currentHostId: number | null = null;
  let currentHostName = "";

  function closeOpen(endedAt: string | null, lastSeenAt: string) {
    if (openStart === null || currentHostId === null) return;
    const start = new Date(`${openStart}Z`).getTime();
    const end = new Date(`${endedAt ?? lastSeenAt}Z`).getTime();
    const durationMinutes = Math.round((end - start) / 60_000);
    if (durationMinutes >= 2) {
      incidents.push({
        id: `down-${currentHostId}-${openStart}`,
        type: "host_down",
        hostId: currentHostId,
        hostName: currentHostName,
        startedAt: openStart,
        endedAt,
        durationMinutes,
        detail: endedAt
          ? `Injoignable pendant ${durationMinutes} min.`
          : `Toujours injoignable depuis ${durationMinutes} min.`,
      });
    }
    openStart = null;
  }

  let lastRowAt = "";
  for (const row of rows) {
    if (row.host_id !== currentHostId) {
      closeOpen(null, lastRowAt);
      currentHostId = row.host_id;
      currentHostName = row.host_name;
    }
    if (row.reachable === 0) {
      if (openStart === null) openStart = row.recorded_at;
    } else if (openStart !== null) {
      closeOpen(row.recorded_at, row.recorded_at);
    }
    lastRowAt = row.recorded_at;
  }
  closeOpen(null, lastRowAt);

  return incidents;
}

type FailedRunRow = { id: string; plan_name: string; host_name: string; started_at: string; finished_at: string | null };

function detectBackupFailedIncidents(days: number): Incident[] {
  const rows = getDb()
    .prepare(
      `SELECT r.id, p.name as plan_name, h.name as host_name, r.started_at, r.finished_at
       FROM backup_runs r
       JOIN backup_plans p ON p.id = r.plan_id
       JOIN hosts h ON h.id = p.source_host_id
       WHERE r.status = 'failed' AND r.started_at > datetime('now', ?)
       ORDER BY r.started_at DESC`
    )
    .all(`-${days} days`) as FailedRunRow[];

  return rows.map((r) => ({
    id: `backup-${r.id}`,
    type: "backup_failed" as const,
    hostId: 0,
    hostName: r.host_name,
    startedAt: r.started_at,
    endedAt: r.finished_at,
    durationMinutes: 0,
    detail: `Le plan de sauvegarde "${r.plan_name}" a échoué.`,
  }));
}

// pulse_history only keeps a rolling 24h (see pulseRecorder.ts) — that's plenty for its original
// job (live uptime charts) but means a host-down incident can never be "found" here past a day
// old, regardless of what `days` the caller asks for. Capped explicitly rather than silently
// returning nothing for a wider window and looking like a bug.
const PULSE_RETENTION_DAYS = 1;

export function detectRecentIncidents(days = 30): Incident[] {
  return [...detectHostDownIncidents(Math.min(days, PULSE_RETENTION_DAYS)), ...detectBackupFailedIncidents(days)].sort(
    (a, b) => b.startedAt.localeCompare(a.startedAt)
  );
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function frenchDateTime(iso: string): string {
  return new Date(`${iso}Z`).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

/**
 * Turns one detected incident into a short, readable narrative — template-based on purpose, not
 * routed through the (optional, self-hosted, sometimes-unconfigured) Ollama assistant: a recap
 * that only works when someone happens to have an LLM configured would defeat the point of "always
 * there when you need it after a bad night". Every fact in the story comes straight from the data
 * that triggered the incident — nothing invented, nothing summarized loosely.
 */
export function generateIncidentStory(incident: Incident): string {
  const lines: string[] = [];

  if (incident.type === "host_down") {
    const ongoing = incident.endedAt === null;
    lines.push(`## ${incident.hostName} a disparu du réseau`);
    lines.push("");
    lines.push(`**${frenchDateTime(incident.startedAt)}** — plus aucune réponse de **${incident.hostName}**.`);
    lines.push("Le panel a commencé à sonder la machine en vain, minute après minute.");
    lines.push("");
    if (ongoing) {
      lines.push(`À l'heure où ce récap est généré, **${incident.hostName}** est toujours injoignable —`);
      lines.push(`ça fait maintenant **${formatDuration(incident.durationMinutes)}**.`);
    } else {
      lines.push(`**${frenchDateTime(incident.endedAt!)}** — ${incident.hostName} a répondu de nouveau.`);
      lines.push(`Coupure totale : **${formatDuration(incident.durationMinutes)}**.`);
    }
    lines.push("");
    lines.push(
      incident.durationMinutes > 60
        ? "Une coupure de cette durée mérite un vrai post-mortem : qu'est-ce qui aurait pu la raccourcir ? Une alerte plus rapide ? Une redondance sur cette machine ?"
        : "Rien de dramatique cette fois, mais chaque coupure — même courte — est un rappel que cette machine n'a peut-être pas de filet de sécurité."
    );
  } else {
    lines.push(`## Une sauvegarde a échoué en silence`);
    lines.push("");
    lines.push(`**${frenchDateTime(incident.startedAt)}** — ${incident.detail}`);
    lines.push("");
    lines.push(
      "Une sauvegarde ratée ne casse rien dans l'immédiat — c'est bien pour ça qu'elle passe inaperçue. " +
        "Le vrai risque, c'est le jour où on en a besoin et qu'elle n'est pas là. Vaut le coup d'aller vérifier " +
        "le journal de ce plan avant que ça se reproduise."
    );
  }

  return lines.join("\n");
}
