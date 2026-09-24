import { randomUUID } from "crypto";
import { getDb } from "../db";
import { runSshCommand, shellQuote } from "../ssh";
import { withTimeout } from "../timeout";
import { vaultEncrypt, vaultDecrypt } from "../crypto";
import { parseMailLogBatch, parseRspamdHistoryRow, type RspamdHistoryRow } from "./mailLogParser";

const FETCH_TIMEOUT_MS = 15_000;
// `docker logs --since` is slow in proportion to the *total* accumulated log size, not the size of
// what it actually returns — a known limitation of Docker's default json-file driver, which has to
// scan the whole file from the start to find where "since" begins. A busy, long-running mail
// container with no log rotation configured can take well past FETCH_TIMEOUT_MS for this reason
// alone, even though the real delta each poll is a few KB — confirmed on a real install where a
// postfix container's `--since 5m` took 18s. Docker log fetching gets its own, much more generous
// budget rather than raising FETCH_TIMEOUT_MS everywhere (the plain-file path via dd/stat has no
// equivalent reason to ever be slow, and shouldn't wait this long before reporting a real problem).
const DOCKER_FETCH_TIMEOUT_MS = 60_000;
// Caps how much a single poll will ever read — a source pointed at a huge, never-rotated log file
// (or added for the first time against a busy mail server with months of history) would otherwise
// try to pull the whole thing in one shot. Later lines get read next poll instead; nothing is lost.
const MAX_FETCH_BYTES = 5_000_000;
// rspamd's controller keeps a bounded history (200 rows by default in Mailcow's history_redis
// config) — this just has to be >= that so nothing already in the response is missed. Everything
// past this cap this poll simply isn't returned by rspamd itself, same "later poll picks it up"
// gap as the file/docker cursor caps above.
const RSPAMD_HISTORY_ROWS = 500;
const RSPAMD_FETCH_TIMEOUT_MS = 15_000;

export type MailSourceType = "file" | "docker" | "rspamd_api";

export type MailLogSource = {
  id: string;
  hostId: number;
  sourceType: MailSourceType;
  sourcePath: string;
  enabled: boolean;
  cursor: string | null;
  lastError: string | null;
  rspamdPort: number | null;
  hasRspamdPassword: boolean;
};

type MailLogSourceRow = {
  id: string;
  host_id: number;
  source_type: MailSourceType;
  source_path: string;
  enabled: number;
  cursor: string | null;
  last_error: string | null;
  rspamd_port: number | null;
  rspamd_password_encrypted: string | null;
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
    rspamdPort: row.rspamd_port,
    hasRspamdPassword: !!row.rspamd_password_encrypted,
  };
}

export function listMailLogSources(): MailLogSource[] {
  return (getDb().prepare(`SELECT * FROM mail_log_sources ORDER BY created_at`).all() as MailLogSourceRow[]).map(
    rowToSource
  );
}

export function addMailLogSource(
  hostId: number,
  sourceType: MailSourceType,
  sourcePath: string,
  options?: { rspamdPort?: number; rspamdPassword?: string }
): MailLogSource {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO mail_log_sources (id, host_id, source_type, source_path, rspamd_port, rspamd_password_encrypted)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      hostId,
      sourceType,
      sourcePath.trim(),
      options?.rspamdPort ?? null,
      options?.rspamdPassword ? vaultEncrypt(options.rspamdPassword) : null
    );
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
    `INSERT OR IGNORE INTO mail_events (source_id, dedupe_key, ip_address, sender_email, subject, recipient, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertMany = getDb().transaction((rows: typeof events) => {
    let inserted = 0;
    for (const e of rows) {
      const result = insert.run(sourceId, e.dedupeKey, e.ip, e.sender, e.subject, e.recipient, e.receivedAt);
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
    DOCKER_FETCH_TIMEOUT_MS,
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

/**
 * Calls rspamd's own HTTP controller API (`/history`) for the subject-bearing message history
 * that neither Postfix's nor rspamd's own log lines can ever carry (see db.ts's comment on
 * mail_log_sources). Run via `docker exec` into the rspamd container itself rather than a direct
 * HTTP call from the panel — the controller worker is normally only bound inside the container's
 * network namespace, and calling it from there also means it's reached via 127.0.0.1, which is
 * the address rspamd's default `secure_ip` trusts without a password on most installs.
 */
async function fetchRspamdHistory(sourceId: string, hostId: number, container: string, port: number): Promise<RspamdHistoryRow[]> {
  const passwordEncrypted = (
    getDb().prepare(`SELECT rspamd_password_encrypted FROM mail_log_sources WHERE id = ?`).get(sourceId) as
      | { rspamd_password_encrypted: string | null }
      | undefined
  )?.rspamd_password_encrypted;
  const password = passwordEncrypted ? vaultDecrypt(passwordEncrypted) : null;
  const url = `http://127.0.0.1:${port}/history?from=0&to=${RSPAMD_HISTORY_ROWS - 1}`;

  // rspamd's own Docker images (including Mailcow's, both Alpine-based) ship curl on some
  // versions and only wget (or neither) on others — tried in order inside the container itself
  // rather than assumed, with the URL/password passed in as env vars (via `docker exec -e`) so
  // neither ever has to be embedded in the inner shell script's own quoting.
  const script =
    `if command -v curl >/dev/null 2>&1; then curl -sS -m 10 ${password ? '-H "Password: $HLP_PW"' : ""} "$HLP_URL"; ` +
    `elif command -v wget >/dev/null 2>&1; then wget -q -O- -T 10 ${password ? '--header="Password: $HLP_PW"' : ""} "$HLP_URL"; ` +
    `else echo "__HLP_NO_HTTP_CLIENT__" 1>&2; exit 127; fi`;
  const envFlags = [`-e HLP_URL=${shellQuote(url)}`, password ? `-e HLP_PW=${shellQuote(password)}` : ""]
    .filter(Boolean)
    .join(" ");
  const command = `docker exec ${envFlags} ${shellQuote(container)} sh -c ${shellQuote(script)}`;

  const { stdout, code, stderr } = await withTimeout(
    runSshCommand(hostId, command, { sudo: true }),
    RSPAMD_FETCH_TIMEOUT_MS,
    "Délai dépassé lors de l'appel à l'API rspamd."
  );
  if (stderr.includes("__HLP_NO_HTTP_CLIENT__")) {
    throw new Error("Ni curl ni wget ne sont disponibles dans ce conteneur — impossible d'appeler l'API rspamd depuis l'intérieur.");
  }
  if (code !== 0) {
    throw new Error(stderr || "Impossible d'appeler l'API rspamd (conteneur ou port incorrect ?).");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("Réponse illisible de l'API rspamd (mot de passe incorrect ?).");
  }
  // The Redis-backed history (module history_redis, active by default on Mailcow — the only
  // shape that ever carries a subject) replies `{rows: [...]}`; rspamd's older in-memory history
  // (no subject field at all) replies a bare array instead — both are accepted so this source
  // type still surfaces IP/sender data even without history_redis, it just won't have a subject.
  const rows = Array.isArray(parsed) ? parsed : (parsed as { rows?: unknown })?.rows;
  if (!Array.isArray(rows)) {
    throw new Error("Réponse inattendue de l'API rspamd (champ 'rows' absent).");
  }
  return rows as RspamdHistoryRow[];
}

/** Pulls whatever's new since this source's last poll, parses it, and stores any recognized mail
 * events — best-effort per source, same shape as every other multi-host sweep in this app
 * (blockIpEverywhere, host stats...): one source failing (host unreachable, path deleted) never
 * blocks the others. */
export async function pollMailLogSource(source: MailLogSource): Promise<number> {
  try {
    if (source.sourceType === "rspamd_api") {
      if (!source.rspamdPort) throw new Error("Port de l'API rspamd non configuré.");
      const rows = await fetchRspamdHistory(source.id, source.hostId, source.sourcePath, source.rspamdPort);
      const events = rows
        .map((row) => parseRspamdHistoryRow(source.id, row))
        .filter((e): e is NonNullable<typeof e> => e !== null);
      const inserted = storeEvents(source.id, events);
      // No meaningful cursor here — /history always returns its whole (bounded) window, and
      // storeEvents' dedupe_key already makes re-inserting the same rows on the next poll a no-op.
      updateCursor(source.id, "", null);
      return inserted;
    }

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
  recipient: string | null;
  receivedAt: string;
};

type MailEventRow = {
  id: number;
  source_id: string;
  ip_address: string | null;
  sender_email: string | null;
  subject: string | null;
  recipient: string | null;
  received_at: string;
};

/**
 * `search` is a free-text match across IP/sender/subject/recipient; `recipient` is a separate
 * exact-match filter (fed by the dropdown of already-seen recipients, listDistinctRecipients
 * below) — the two can be combined, e.g. narrow to one mailbox and then search its own history.
 */
export function listMailEvents(limit = 200, search?: string, recipient?: string): MailEvent[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (search) {
    conditions.push("(ip_address LIKE ? OR sender_email LIKE ? OR subject LIKE ? OR recipient LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (recipient) {
    // Stored recipients can be a comma-joined list for a multi-recipient message — LIKE rather
    // than an exact match so filtering by one address still finds those.
    conditions.push("recipient LIKE ?");
    params.push(`%${recipient}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = getDb()
    .prepare(`SELECT * FROM mail_events ${where} ORDER BY received_at DESC LIMIT ?`)
    .all(...params, limit) as MailEventRow[];

  return rows.map((r) => ({
    id: r.id,
    sourceId: r.source_id,
    ipAddress: r.ip_address,
    senderEmail: r.sender_email,
    subject: r.subject,
    recipient: r.recipient,
    receivedAt: r.received_at,
  }));
}

/** Distinct, already-seen recipients — powers the filter dropdown on the Anti-spam page rather
 * than a free-text field, so picking one always matches something real. A stored value can be a
 * comma-joined list for a multi-recipient message (see parseRspamdHistoryRow/parseRspamdLine), so
 * each is split back into individual addresses before deduping. */
export function listDistinctRecipients(): string[] {
  const rows = getDb()
    .prepare(`SELECT DISTINCT recipient FROM mail_events WHERE recipient IS NOT NULL AND recipient != ''`)
    .all() as { recipient: string }[];
  const addresses = new Set<string>();
  for (const row of rows) {
    for (const addr of row.recipient.split(",")) {
      const trimmed = addr.trim();
      if (trimmed) addresses.add(trimmed);
    }
  }
  return Array.from(addresses).sort();
}
