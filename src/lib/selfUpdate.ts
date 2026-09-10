import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtempSync, rmSync, cpSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { getDb } from "./db";
import { getCurrentVersion, isNewerVersion } from "./version";
import { getLicenseServerUrl, getActivationKey } from "./license";

const execFileAsync = promisify(execFile);

export type UpdateCheck = {
  currentVersion: string;
  latestVersion: string | null;
  changelog: string | null;
  updateAvailable: boolean;
};

/** No-ops (rather than erroring) when this instance has no license server configured — the
 * seller's own deployment and a raw repo checkout both fall in that bucket. */
export async function checkForUpdate(): Promise<UpdateCheck> {
  const currentVersion = getCurrentVersion();
  const serverUrl = getLicenseServerUrl();
  if (!serverUrl) return { currentVersion, latestVersion: null, changelog: null, updateAvailable: false };

  try {
    const res = await fetch(`${serverUrl.replace(/\/$/, "")}/api/seller/releases/latest`, {
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json();
    const release = data.release as { version: string; changelog: string } | null;
    if (!release) return { currentVersion, latestVersion: null, changelog: null, updateAvailable: false };

    return {
      currentVersion,
      latestVersion: release.version,
      changelog: release.changelog,
      updateAvailable: isNewerVersion(release.version, currentVersion),
    };
  } catch {
    return { currentVersion, latestVersion: null, changelog: null, updateAvailable: false };
  }
}

export type SelfUpdateJob = {
  id: string;
  fromVersion: string;
  toVersion: string;
  status: "running" | "success" | "failed";
  log: string;
  startedAt: string;
  finishedAt: string | null;
};

type JobRow = {
  id: string;
  from_version: string;
  to_version: string;
  status: "running" | "success" | "failed";
  log: string;
  started_at: string;
  finished_at: string | null;
};

function rowToJob(row: JobRow): SelfUpdateJob {
  return {
    id: row.id,
    fromVersion: row.from_version,
    toVersion: row.to_version,
    status: row.status,
    log: row.log,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function getSelfUpdateJob(id: string): SelfUpdateJob | null {
  const row = getDb().prepare(`SELECT * FROM self_update_jobs WHERE id = ?`).get(id) as JobRow | undefined;
  return row ? rowToJob(row) : null;
}

function appendLog(jobId: string, text: string) {
  getDb().prepare(`UPDATE self_update_jobs SET log = log || ? WHERE id = ?`).run(`${text}\n`, jobId);
}

function finishJob(jobId: string, status: "success" | "failed") {
  getDb()
    .prepare(`UPDATE self_update_jobs SET status = ?, finished_at = datetime('now') WHERE id = ?`)
    .run(status, jobId);
}

/**
 * Starts the self-update in the background and returns immediately with a job id to poll —
 * mirrors startUpdateJob() in lib/updates.ts, just running locally (child_process) instead of
 * over SSH, since this instance is updating itself rather than a remote host.
 */
export function startSelfUpdateJob(toVersion: string): string {
  const fromVersion = getCurrentVersion();
  const jobId = randomUUID();
  getDb()
    .prepare(`INSERT INTO self_update_jobs (id, from_version, to_version, status, log) VALUES (?, ?, ?, 'running', '')`)
    .run(jobId, fromVersion, toVersion);

  runSelfUpdate(jobId).catch((err) => {
    appendLog(jobId, `Erreur: ${err instanceof Error ? err.message : "inconnue"}`);
    finishJob(jobId, "failed");
  });

  return jobId;
}

async function runSelfUpdate(jobId: string): Promise<void> {
  const serverUrl = getLicenseServerUrl();
  const key = getActivationKey();
  if (!serverUrl || !key) {
    appendLog(jobId, "Erreur: aucun serveur de mise à jour ou clé d'activation pour cette instance.");
    finishJob(jobId, "failed");
    return;
  }

  const projectRoot = process.cwd();
  const workDir = mkdtempSync(path.join(tmpdir(), "homelab-panel-selfupdate-"));
  const zipPath = path.join(workDir, "update.zip");
  const extractDir = path.join(workDir, "extracted");

  try {
    appendLog(jobId, "Téléchargement de la mise à jour...");
    const res = await fetch(`${serverUrl.replace(/\/$/, "")}/api/seller/releases/download?key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`Téléchargement échoué (${res.status}).`);
    const buffer = Buffer.from(await res.arrayBuffer());
    await import("fs").then((fs) => fs.writeFileSync(zipPath, buffer));

    appendLog(jobId, "Extraction de l'archive...");
    if (!existsSync(extractDir)) await import("fs").then((fs) => fs.mkdirSync(extractDir, { recursive: true }));
    try {
      await execFileAsync("unzip", ["-o", zipPath, "-d", extractDir]);
    } catch (err) {
      throw new Error(
        `Échec de l'extraction (la commande 'unzip' est-elle installée ? 'apt install unzip'). ${
          err instanceof Error ? err.message : ""
        }`
      );
    }

    appendLog(jobId, "Copie des nouveaux fichiers (data/ et .env sont préservés)...");
    cpSync(extractDir, projectRoot, { recursive: true, force: true });

    // Deliberately not --omit=dev: typescript and tailwindcss are devDependencies but are
    // required by the "npm run build" step right after this, even though they're not needed
    // once the production build exists.
    appendLog(jobId, "Installation des dépendances (npm install)...");
    const install = await execFileAsync("npm", ["install"], { cwd: projectRoot });
    appendLog(jobId, install.stdout.slice(-2000));

    appendLog(jobId, "Compilation (npm run build)...");
    const build = await execFileAsync("npm", ["run", "build"], { cwd: projectRoot });
    appendLog(jobId, build.stdout.slice(-2000));

    appendLog(jobId, "Mise à jour appliquée. Redémarrage du service...");
    finishJob(jobId, "success");

    // Relies on a process supervisor (pm2, systemd with Restart=always/on-failure) to bring the
    // process back up on the new code — exiting cleanly is the most portable "restart" available
    // from inside the process itself, since we can't assume which supervisor (if any) is in use.
    setTimeout(() => process.exit(0), 1500);
  } catch (err) {
    appendLog(jobId, `Erreur: ${err instanceof Error ? err.message : "inconnue"}`);
    finishJob(jobId, "failed");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
