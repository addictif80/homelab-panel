import { getDb, getSetting, setSetting } from "../db";
import { scanAllHosts } from "../security/scan";
import { hasAnyNotificationChannel, notifyAll } from "./notify";
import type { Finding } from "../security/types";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly
const RENOTIFY_AFTER_MS = 24 * 60 * 60 * 1000; // remind once a day while a problem persists
const FIRST_RUN_DELAY_MS = 60_000;
const MIN_SEND_GAP_MS = 30 * 60 * 1000; // never send two notification emails closer than this
const LAST_CHECK_SETTING_KEY = "security_notify_last_check_at";
const LAST_SENT_SETTING_KEY = "security_notify_last_sent_at";

function shouldNotify(key: string): boolean {
  const row = getDb()
    .prepare(`SELECT last_notified_at FROM notified_findings WHERE finding_key = ?`)
    .get(key) as { last_notified_at: string } | undefined;
  if (!row) return true;
  return Date.now() - new Date(`${row.last_notified_at}Z`).getTime() > RENOTIFY_AFTER_MS;
}

function markNotified(key: string) {
  getDb()
    .prepare(
      `INSERT INTO notified_findings (finding_key, last_notified_at) VALUES (?, datetime('now'))
       ON CONFLICT(finding_key) DO UPDATE SET last_notified_at = datetime('now')`
    )
    .run(key);
}

async function runCheck() {
  setSetting(LAST_CHECK_SETTING_KEY, new Date().toISOString());
  if (!hasAnyNotificationChannel()) return;

  try {
    const results = await scanAllHosts();
    const toNotify: { hostName: string; finding: Finding; key: string }[] = [];

    for (const host of results) {
      if (host.error) continue;
      for (const finding of host.findings) {
        if (finding.ignored) continue;
        if (finding.severity !== "critical" && finding.severity !== "warning") continue;
        const key = `${host.hostId}:${finding.id}`;
        if (shouldNotify(key)) toNotify.push({ hostName: host.hostName, finding, key });
      }
    }

    if (toNotify.length === 0) return;

    // A floor between two actual sends, independent of the per-finding 24h re-notify logic above —
    // it's what actually stops a mailbox flood if something (a restart loop, a future bug) causes
    // this check to run back-to-back: findings that lose out here simply stay un-marked and get
    // picked up, still deduplicated, on the very next run.
    const lastSentAt = getSetting(LAST_SENT_SETTING_KEY);
    if (lastSentAt && Date.now() - Date.parse(lastSentAt) < MIN_SEND_GAP_MS) return;

    const lines = toNotify.map(
      (n) => `- [${n.finding.severity.toUpperCase()}] ${n.hostName} : ${n.finding.title}\n  ${n.finding.detail}`
    );
    const subject = `[Homelab Panel] ${toNotify.length} alerte${toNotify.length > 1 ? "s" : ""} de sécurité`;
    const text = `Le Centre de sécurité a détecté ce qui suit :\n\n${lines.join("\n\n")}\n\nConnecte-toi au panel (page Sécurité) pour appliquer les correctifs proposés, ou ignorer une alerte si elle n'est pas pertinente.`;

    await notifyAll(subject, text);
    setSetting(LAST_SENT_SETTING_KEY, new Date().toISOString());
    for (const n of toNotify) markNotified(n.key);
  } catch {
    // Best-effort: a failed scan or notification send shouldn't crash the server, just skip this round.
  }
}

let started = false;

/** Starts the hourly security/update check. Safe to call multiple times — only arms once. */
export function startNotificationScheduler() {
  if (started) return;
  started = true;

  // A server restart used to always re-arm a fresh 60s "first run" timer, no matter how recently
  // the previous process had already checked. On a host that restarts often (deploys, crashes, a
  // dev server reloading), that fired the "hourly" check every few minutes instead of every hour —
  // exactly the flood of emails a few minutes apart reported here. Anchoring the first run to the
  // persisted last-check time means a restart just resumes the same hourly cadence instead of
  // resetting it.
  const lastCheckAt = getSetting(LAST_CHECK_SETTING_KEY);
  const elapsedSinceLastCheck = lastCheckAt ? Date.now() - Date.parse(lastCheckAt) : Infinity;
  const initialDelay = Number.isFinite(elapsedSinceLastCheck)
    ? Math.max(FIRST_RUN_DELAY_MS, CHECK_INTERVAL_MS - elapsedSinceLastCheck)
    : FIRST_RUN_DELAY_MS;

  setTimeout(runCheck, initialDelay);
  setInterval(runCheck, CHECK_INTERVAL_MS);
}
