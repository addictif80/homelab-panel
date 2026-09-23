import { createHash } from "crypto";

export type ParsedMailEvent = {
  dedupeKey: string;
  ip: string | null;
  sender: string | null;
  subject: string | null;
  receivedAt: string;
};

function dedupeKey(parts: (string | null)[]): string {
  return createHash("sha1").update(parts.join("|")).digest("hex");
}

// rspamd's own per-message summary line (rspamd_task_write_log) carries ip, envelope sender and
// subject all on one line, complete — the closest thing to a universal "spam filter" log format
// across self-hosted stacks (Mailcow, Mail-in-a-Box and most from-scratch Postfix setups run
// rspamd rather than rolling their own). Field order/spacing varies a bit by version, so each
// field is matched independently rather than as one big pattern.
const RSPAMD_MARKER = /rspamd_task_write_log/;
const RSPAMD_TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/;
const RSPAMD_IP_RE = /\bip:\s*([0-9a-fA-F:.]+)/;
const RSPAMD_FROM_RE = /\bfrom:\s*<([^>]*)>/;
const RSPAMD_SUBJECT_RE = /\bsubject:\s*"((?:[^"\\]|\\.)*)"/;

function parseRspamdLine(sourceId: string, line: string): ParsedMailEvent | null {
  if (!RSPAMD_MARKER.test(line)) return null;
  const ts = line.match(RSPAMD_TIMESTAMP_RE)?.[1];
  const ip = line.match(RSPAMD_IP_RE)?.[1] ?? null;
  const from = line.match(RSPAMD_FROM_RE)?.[1] ?? null;
  const subject = line.match(RSPAMD_SUBJECT_RE)?.[1]?.replace(/\\"/g, '"') ?? null;
  if (!ip && !from) return null;

  return {
    dedupeKey: dedupeKey([sourceId, "rspamd", ip, from, ts ?? line]),
    ip,
    sender: from,
    subject,
    receivedAt: ts ? new Date(ts.replace(" ", "T")).toISOString() : new Date().toISOString(),
  };
}

// Standard syslog line from Postfix: "Mon DD HH:MM:SS host process[pid]: QUEUEID: rest". No
// subject (Postfix's own logs never see message content, only envelope/connection info) — a
// message is identified by its queue ID, which shows up on multiple separate lines that have to
// be correlated: the connecting IP first (smtpd's client=...), the envelope sender later (qmgr's
// from=...). The qmgr line is treated as "message fully seen" and is what actually emits a record.
const SYSLOG_LINE_RE = /^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+\S+\s+\S+\[\d+\]:\s+([0-9A-Za-z]+):\s*(.*)$/;
const CLIENT_IP_RE = /client=[^[]*\[([0-9a-fA-F:.]+)\]/;
const FROM_RE = /\bfrom=<([^>]*)>/;

function parseSyslogTimestamp(ts: string): string {
  // No year in a syslog timestamp — assumed to be "this year", which is correct for anything but
  // logs spanning a New Year's boundary read more than a few minutes late (an acceptable
  // imprecision for a live spam-tracking feed rather than a forensic log archive).
  const withYear = `${ts} ${new Date().getFullYear()}`;
  const parsed = new Date(withYear);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

/**
 * Parses one batch of freshly-read log lines into finished mail events, trying the rspamd format
 * first (self-contained, one line per message) and falling back to Postfix's own multi-line
 * client+queue-id correlation for anything rspamd didn't already claim. Correlation state lives
 * only within this one batch — a connect line and its matching qmgr line landing in two different
 * polling cycles won't be joined, which is an accepted gap given how frequently the scheduler
 * polls relative to how quickly Postfix normally logs both lines for the same message.
 */
export type RspamdHistoryRow = {
  unix_time?: number;
  ip?: string;
  sender_smtp?: string;
  sender_mime?: string;
  subject?: string;
  action?: string;
  score?: number;
};

/**
 * Turns one row of rspamd's own /history API response into an event — the only source that can
 * ever carry a real subject (see db.ts's comment on mail_log_sources for why the log-line parsers
 * above never can). `unknown` is what rspamd itself fills a missing field with in this API, same
 * meaning as this parser's own `null`.
 */
export function parseRspamdHistoryRow(sourceId: string, row: RspamdHistoryRow): ParsedMailEvent | null {
  const clean = (v: string | undefined): string | null => (v && v !== "unknown" ? v : null);
  const ip = clean(row.ip);
  const sender = clean(row.sender_smtp) ?? clean(row.sender_mime);
  const subject = clean(row.subject);
  if (!ip && !sender) return null;

  const receivedAt = row.unix_time ? new Date(row.unix_time * 1000).toISOString() : new Date().toISOString();
  return {
    dedupeKey: dedupeKey([sourceId, "rspamd_api", ip, sender, subject, String(row.unix_time ?? "")]),
    ip,
    sender,
    subject,
    receivedAt,
  };
}

export function parseMailLogBatch(sourceId: string, lines: string[]): ParsedMailEvent[] {
  const events: ParsedMailEvent[] = [];
  const ipByQueueId = new Map<string, string>();

  for (const line of lines) {
    if (!line.trim()) continue;

    const rspamdEvent = parseRspamdLine(sourceId, line);
    if (rspamdEvent) {
      events.push(rspamdEvent);
      continue;
    }

    const syslogMatch = line.match(SYSLOG_LINE_RE);
    if (!syslogMatch) continue;
    const [, ts, queueId, rest] = syslogMatch;

    const clientIp = rest.match(CLIENT_IP_RE)?.[1];
    if (clientIp) {
      ipByQueueId.set(queueId, clientIp);
      continue;
    }

    const from = rest.match(FROM_RE)?.[1];
    if (from) {
      const ip = ipByQueueId.get(queueId) ?? null;
      events.push({
        dedupeKey: dedupeKey([sourceId, "postfix", queueId, from, ts]),
        ip,
        sender: from || null,
        subject: null,
        receivedAt: parseSyslogTimestamp(ts),
      });
    }
  }

  return events;
}
