import { randomUUID } from "crypto";
import { getDb } from "../db";
import { runSshCommand, shellQuote } from "../ssh";
import { withTimeout } from "../timeout";
import { parseMailLogBatch } from "./mailLogParser";

const FETCH_TIMEOUT_MS = 15_000;
// Caps how much a single poll will ever read — a source pointed at a huge, never-rotated log file
// (or added for the first time against a busy mail server with months of history) would otherwise
// try to pull the whole thing in one shot. Later lines get read next poll instead; nothing is lost.
const MAX_FETCH_BYTES = 5_000_000;

export type MailLogSource = {
  id: string;
  hostId: number;
  sourceType: "file" | "docker";
  sourcePath: string;
  enabled: boolean;
  cursor: string | null;
  lastError: string | null;
};

type MailLogSourceRow = {
  id: string;
  host_id: number;
  source_type: "file" | "docker";
  source_path: string;
  enabled: number;
  cursor: string | null;
  last_error: string | null;
};

function rowToSource(row: MailLogSourceRow): MailLogSource {
  return {
    id: row.id,
    hostId: row.host_id,
    sourceType: row.source_type,
    sourcePath: row.source_path,
    enabled: row.enabled === 1,
    cursor: row.cursor,
    lastError: row.last_error,
  };
}

export function listMailLogSources(): MailLogSource[] {
  return (getDb().prepare(`SELECT * FROM mail_log_sources ORDER BY created_at`).all() as MailLogSourceRow[]).map(
    rowToSource
  );
}

export function addMailLogSource(hostId: number, sourceType: "file" | "docker", sourcePath: string): MailLogSource {
  const id = randomUUID();
  getDb()
    .prepare(`INSERT INTO mail_log_sources (id, host_id, source_type, source_path) VALUES (?, ?, ?, ?)`)
    .run(id, hostId, sourceType, sourcePath.trim());
  return rowToSource(
    getDb().prepare(`SELECT * FROM mail_log_sources WHERE id = ?`).get(id) as MailLogSourceRow
  );
}

export function deleteMailLogSource(id: string): void {
  getDb().prepare(`DELETE FROM mail_log_sources WHERE id = ?`).run(id);
}

export function setMailLogSourceEnabled(id: string, enabled: boolean): void {
  getDb().prepare(`UPDATE mail_log_sources SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id);
}

function updateCursor(id: string, cursor: string, lastError: null): void;
function updateCursor(id: string, cursor: string | null, lastError: string): void;
function updateCursor(id: string, cursor: string | null, lastError: string | null): void {
  getDb().prepare(`UPDATE mail_log_sources SET cursor = ?, last_error = ? WHERE id = ?`).run(cursor, lastError, id);
}

function storeEvents(sourceId: string, events: ReturnType<typeof parseMailLogBatch>): number {
  if (events.length === 0) return 0;
  const insert = getDb().prepare(
    `INSERT OR IGNORE INTO mail_events (source_id, dedupe_key, ip_address, sender_email, subject, received_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertMany = getDb().transaction((rows: typeof events) => {
    let inserted = 0;
    for (const e of rows) {
      const result = insert.run(sourceId, e.dedupeKey, e.ip, e.sender, e.subject, e.receivedAt);
      if (result.changes > 0) inserted++;
    }
    return inserted;
  });
  return insertMany(events);
}

/** Byte offset a `file` source has already consumed — 0 for a source that's never been read, or
 * after the file shrank (rotation/truncation), since anything already-read may no longer exist. */
async function fetchNewFileContent(hostId: number, path: string, cursor: string | null): Promise<{
  content: string;
  nextCursor: string;
}> {
  const offset = cursor ? parseInt(cursor, 10) || 0 : 0;
  const command = [
    `SIZE=$(stat -c %s ${shellQuote(path)} 2>/dev/null || echo 0)`,
    `if [ "$SIZE" -lt ${offset} ]; then OFFSET=0; else OFFSET=${offset}; fi`,
    `dd if=${shellQuote(path)} bs=1 skip=$OFFSET count=${MAX_FETCH_BYTES} 2>/dev/null`,
    `echo`,
    `echo "__HLP_MAIL_SIZE__$SIZE"`,
  ].join("\n");

  const { stdout, code, stderr } = await withTimeout(
    runSshCommand(hostId, command, { sudo: true }),
    FETCH_TIMEOUT_MS,
    "Délai dépassé lors de la lecture du journal mail."
  );
  if (code !== 0) throw new Error(stderr || "Impossible de lire le fichier de log.");

  const marker = "__HLP_MAIL_SIZE__";
  const markerIdx = stdout.lastIndexOf(marker);
  if (markerIdx === -1) return { content: "", nextCursor: cursor ?? "0" };
  const size = stdout.slice(markerIdx + marker.length).trim();
  const content = stdout.slice(0, markerIdx).replace(/\n$/, "");
  const bytesRead = Buffer.byteLength(content, "utf8");
  const newOffset = (offset > parseInt(size, 10) ? 0 : offset) + bytesRead;
  return { content, nextCursor: String(newOffset) };
}

async function fetchNewDockerContent(
  hostId: number,
  container: string,
  cursor: string | null
): Promise<{ content: string; nextCursor: string }> {
  const since = cursor ?? new Date(Date.now() - 5 * 60_000).toISOString();
  const command = `docker logs --since ${shellQuote(since)} --timestamps ${shellQuote(container)} 2>&1 | head -c ${MAX_FETCH_BYTES}`;

  const { stdout, code, stderr } = await withTimeout(
    runSshCommand(hostId, command, { sudo: true }),
    FETCH_TIMEOUT_MS,
    "Délai dépassé lors de la lecture des logs Docker."
  );
  // A non-zero exit here usually just means the container doesn't exist (renamed/removed) —
  // surfaced as lastError rather than thrown, same as a missing log file.
  if (code !== 0) throw new Error(stderr || "Impossible de lire les logs du conteneur.");

  let latestTimestamp = cursor;
  const strippedLines: string[] = [];
  for (const line of stdout.split("\n")) {
    const spaceIdx = line.indexOf(" ");
    if (spaceIdx === -1) continue;
    const ts = line.slice(0, spaceIdx);
    if (!Number.isNaN(Date.parse(ts))) {
      if (!latestTimestamp || ts > latestTimestamp) latestTimestamp = ts;
      strippedLines.push(line.slice(spaceIdx + 1));
    }
  }
  return { content: strippedLines.join("\n"), nextCursor: latestTimestamp ?? since };
}

/** Pulls whatever's new since this source's last poll, parses it, and stores any recognized mail
 * events — best-effort per source, same shape as every other multi-host sweep in this app
 * (blockIpEverywhere, host stats...): one source failing (host unreachable, path deleted) never
 * blocks the others. */
export async function pollMailLogSource(source: MailLogSource): Promise<number> {
  try {
    const { content, nextCursor } =
      source.sourceType === "file"
        ? await fetchNewFileContent(source.hostId, source.sourcePath, source.cursor)
        : await fetchNewDockerContent(source.hostId, source.sourcePath, source.cursor);

    const events = parseMailLogBatch(source.id, content.split("\n"));
    const inserted = storeEvents(source.id, events);
    updateCursor(source.id, nextCursor, null);
    return inserted;
  } catch (err) {
    updateCursor(source.id, source.cursor, err instanceof Error ? err.message : "Erreur inconnue.");
    return 0;
  }
}

export async function pollAllMailLogSources(): Promise<void> {
  const sources = listMailLogSources().filter((s) => s.enabled);
  await Promise.all(sources.map((s) => pollMailLogSource(s)));
}

export type MailEvent = {
  id: number;
  sourceId: string;
  ipAddress: string | null;
  senderEmail: string | null;
  subject: string | null;
  receivedAt: string;
};

type MailEventRow = {
  id: number;
  source_id: string;
  ip_address: string | null;
  sender_email: string | null;
  subject: string | null;
  received_at: string;
};

export function listMailEvents(limit = 200, search?: string): MailEvent[] {
  const rows = search
    ? (getDb()
        .prepare(
          `SELECT * FROM mail_events WHERE ip_address LIKE ? OR sender_email LIKE ? OR subject LIKE ?
           ORDER BY received_at DESC LIMIT ?`
        )
        .all(`%${search}%`, `%${search}%`, `%${search}%`, limit) as MailEventRow[])
    : (getDb().prepare(`SELECT * FROM mail_events ORDER BY received_at DESC LIMIT ?`).all(limit) as MailEventRow[]);

  return rows.map((r) => ({
    id: r.id,
    sourceId: r.source_id,
    ipAddress: r.ip_address,
    senderEmail: r.sender_email,
    subject: r.subject,
    receivedAt: r.received_at,
  }));
}
