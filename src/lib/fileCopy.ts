import { randomUUID } from "crypto";
import type { SFTPWrapper } from "ssh2";
import { getDb } from "./db";
import { openSftp, statPath, readdirEntries, mkdirIfMissing, streamCopy } from "./sftp";

export type CopyJobStatus = "running" | "success" | "failed";

export type CopyJob = {
  id: string;
  sourceHostId: number;
  sourcePath: string;
  destHostId: number;
  destPath: string;
  status: CopyJobStatus;
  log: string;
  startedAt: string;
  finishedAt: string | null;
};

type CopyJobRow = {
  id: string;
  source_host_id: number;
  source_path: string;
  dest_host_id: number;
  dest_path: string;
  status: CopyJobStatus;
  log: string;
  started_at: string;
  finished_at: string | null;
};

function rowToJob(row: CopyJobRow): CopyJob {
  return {
    id: row.id,
    sourceHostId: row.source_host_id,
    sourcePath: row.source_path,
    destHostId: row.dest_host_id,
    destPath: row.dest_path,
    status: row.status,
    log: row.log,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function getCopyJob(jobId: string): CopyJob | null {
  const row = getDb().prepare(`SELECT * FROM copy_jobs WHERE id = ?`).get(jobId) as CopyJobRow | undefined;
  return row ? rowToJob(row) : null;
}

function appendLog(jobId: string, text: string) {
  getDb().prepare(`UPDATE copy_jobs SET log = log || ? WHERE id = ?`).run(text, jobId);
}

function finishJob(jobId: string, status: "success" | "failed") {
  getDb().prepare(`UPDATE copy_jobs SET status = ?, finished_at = datetime('now') WHERE id = ?`).run(status, jobId);
}

function joinRemote(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

/**
 * Copying between two different machines can't use `scp`/`rsync` directly (the panel doesn't
 * hold credentials that let the source host log into the destination) — instead this relays
 * the data itself: read from the source over SFTP, write to the destination over SFTP, one
 * file at a time, streamed rather than buffered whole in memory.
 */
export function startCopyJob(
  sourceHostId: number,
  sourcePath: string,
  destHostId: number,
  destPath: string
): string {
  const jobId = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO copy_jobs (id, source_host_id, source_path, dest_host_id, dest_path, status, log)
       VALUES (?, ?, ?, ?, ?, 'running', '')`
    )
    .run(jobId, sourceHostId, sourcePath, destHostId, destPath);

  runCopyJob(jobId, sourceHostId, sourcePath, destHostId, destPath);

  return jobId;
}

async function runCopyJob(jobId: string, sourceHostId: number, sourcePath: string, destHostId: number, destPath: string) {
  let source: Awaited<ReturnType<typeof openSftp>> | undefined;
  let dest: Awaited<ReturnType<typeof openSftp>> | undefined;
  try {
    source = await openSftp(sourceHostId);
    dest = await openSftp(destHostId);
    await copyRecursive(source.sftp, sourcePath, dest.sftp, destPath, jobId);
    appendLog(jobId, `\nTerminé.\n`);
    finishJob(jobId, "success");
  } catch (err) {
    appendLog(jobId, `\nErreur : ${err instanceof Error ? err.message : "inconnue"}\n`);
    finishJob(jobId, "failed");
  } finally {
    source?.conn.end();
    dest?.conn.end();
  }
}

async function copyRecursive(
  sourceSftp: SFTPWrapper,
  sourcePath: string,
  destSftp: SFTPWrapper,
  destPath: string,
  jobId: string
) {
  const stat = await statPath(sourceSftp, sourcePath);

  if (stat.isDirectory) {
    await mkdirIfMissing(destSftp, destPath);
    appendLog(jobId, `Dossier : ${destPath}\n`);
    const entries = await readdirEntries(sourceSftp, sourcePath);
    for (const entry of entries) {
      if (entry.name === "." || entry.name === "..") continue;
      await copyRecursive(sourceSftp, joinRemote(sourcePath, entry.name), destSftp, joinRemote(destPath, entry.name), jobId);
    }
    return;
  }

  await streamCopy(sourceSftp, sourcePath, destSftp, destPath);
  appendLog(jobId, `Copié : ${destPath} (${formatSize(stat.size)})\n`);
}
