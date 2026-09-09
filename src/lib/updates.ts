import { randomUUID } from "crypto";
import { Client as SshClient } from "ssh2";
import { buildSshConfig, buildPrivilegedCommand } from "./ssh";
import { getDb } from "./db";

export type UpdateMethod = "apt" | "opkg" | "dsm";
export type UpdateMode = "dry-run" | "apply";

type CommandSet = {
  dryRun: string;
  apply: string;
  /** Marker printed to stdout when a reboot is needed; null if the method never triggers one. */
  rebootCheck: string | null;
  supportsAutoReboot: boolean;
};

const REBOOT_MARKER = "__HOMELAB_REBOOT_REQUIRED__";

const COMMANDS: Record<UpdateMethod, CommandSet> = {
  apt: {
    dryRun: "export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get -s dist-upgrade",
    apply:
      "export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get -y dist-upgrade && apt-get -y autoremove",
    rebootCheck: `test -f /var/run/reboot-required && echo ${REBOOT_MARKER} || true`,
    supportsAutoReboot: true,
  },
  opkg: {
    dryRun: "opkg update && opkg list-upgradable",
    apply: "opkg update; opkg list-upgradable | cut -f1 -d' ' | xargs -r -n1 opkg upgrade",
    // Never auto-reboot the router: it would cut off access to every other machine mid-update.
    rebootCheck: null,
    supportsAutoReboot: false,
  },
  dsm: {
    dryRun:
      "/usr/syno/bin/synoupgrade --check 2>/dev/null || echo 'Vérification DSM non disponible via SSH standard sur ce modèle.'",
    apply:
      "echo 'Mise à jour DSM à confirmer manuellement : Panneau de configuration > Mise à jour et restauration.'",
    rebootCheck: null,
    supportsAutoReboot: false,
  },
};

export function buildUpdateCommand(
  method: UpdateMethod,
  mode: UpdateMode,
  allowAutoReboot: boolean
): string {
  const set = COMMANDS[method];
  if (!set) throw new Error(`Méthode de mise à jour inconnue: ${method}`);

  const base = mode === "dry-run" ? set.dryRun : set.apply;
  if (mode === "dry-run" || !set.rebootCheck) return base;

  // On apply: check whether a reboot is needed, and either just report it or trigger a
  // delayed reboot (delayed so the SSH exec channel returns cleanly before the box goes down).
  const rebootAction = allowAutoReboot && set.supportsAutoReboot
    ? `if [ "$reboot_check" = "${REBOOT_MARKER}" ]; then echo 'Redémarrage requis, planifié dans 5s...'; nohup sh -c 'sleep 5 && reboot' >/dev/null 2>&1 & fi`
    : `if [ "$reboot_check" = "${REBOOT_MARKER}" ]; then echo 'Redémarrage requis (non appliqué automatiquement).'; fi`;

  return `${base}; reboot_check=$(${set.rebootCheck}); ${rebootAction}`;
}

export type UpdateJobStatus = "running" | "success" | "failed";

export type UpdateJob = {
  id: string;
  hostId: number;
  mode: UpdateMode;
  status: UpdateJobStatus;
  log: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
};

type UpdateJobRow = {
  id: string;
  host_id: number;
  mode: UpdateMode;
  status: UpdateJobStatus;
  log: string;
  exit_code: number | null;
  started_at: string;
  finished_at: string | null;
};

function rowToJob(row: UpdateJobRow): UpdateJob {
  return {
    id: row.id,
    hostId: row.host_id,
    mode: row.mode,
    status: row.status,
    log: row.log,
    exitCode: row.exit_code,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function getUpdateJob(jobId: string): UpdateJob | null {
  const row = getDb().prepare(`SELECT * FROM update_jobs WHERE id = ?`).get(jobId) as
    | UpdateJobRow
    | undefined;
  return row ? rowToJob(row) : null;
}

export function getLatestUpdateJob(hostId: number): UpdateJob | null {
  const row = getDb()
    .prepare(`SELECT * FROM update_jobs WHERE host_id = ? ORDER BY started_at DESC LIMIT 1`)
    .get(hostId) as UpdateJobRow | undefined;
  return row ? rowToJob(row) : null;
}

function appendJobLog(jobId: string, text: string) {
  if (!text) return;
  getDb().prepare(`UPDATE update_jobs SET log = log || ? WHERE id = ?`).run(text, jobId);
}

function finishJob(jobId: string, status: "success" | "failed", exitCode: number | null) {
  getDb()
    .prepare(
      `UPDATE update_jobs SET status = ?, exit_code = ?, finished_at = datetime('now') WHERE id = ?`
    )
    .run(status, exitCode, jobId);
}

/**
 * Starts an update job that runs to completion on the server independent of any browser
 * connection — the caller gets a job id back immediately and can poll getUpdateJob/
 * getLatestUpdateJob to follow progress, including after navigating away and back.
 */
export function startUpdateJob(hostId: number, mode: UpdateMode, rawCommand: string): string {
  const jobId = randomUUID();
  getDb()
    .prepare(`INSERT INTO update_jobs (id, host_id, mode, status, log) VALUES (?, ?, ?, 'running', '')`)
    .run(jobId, hostId, mode);

  runJobInBackground(jobId, hostId, rawCommand);

  return jobId;
}

function runJobInBackground(jobId: string, hostId: number, rawCommand: string) {
  let config;
  let command: string;
  let stdinPassword: string | null;
  try {
    config = buildSshConfig(hostId);
    ({ command, stdinPassword } = buildPrivilegedCommand(hostId, rawCommand));
  } catch (err) {
    appendJobLog(jobId, `Erreur: ${err instanceof Error ? err.message : "inconnue"}\n`);
    finishJob(jobId, "failed", null);
    return;
  }

  const conn = new SshClient();

  conn.on("ready", () => {
    conn.exec(command, (err, stream) => {
      if (err) {
        appendJobLog(jobId, `Erreur: ${err.message}\n`);
        finishJob(jobId, "failed", null);
        conn.end();
        return;
      }
      if (stdinPassword) stream.write(`${stdinPassword}\n`);
      stream.on("data", (data: Buffer) => appendJobLog(jobId, data.toString("utf8")));
      stream.stderr.on("data", (data: Buffer) => appendJobLog(jobId, data.toString("utf8")));
      stream.on("close", (code: number) => {
        finishJob(jobId, code === 0 ? "success" : "failed", code);
        conn.end();
      });
    });
  });

  conn.on("error", (err) => {
    appendJobLog(jobId, `Erreur: ${err.message}\n`);
    finishJob(jobId, "failed", null);
  });

  conn.connect(config);
}
