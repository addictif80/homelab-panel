import { getDb } from "../db";
import { getSmtpConfig, sendMail } from "../mail";
import { scanAllHosts } from "../security/scan";
import type { Finding } from "../security/types";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly
const RENOTIFY_AFTER_MS = 24 * 60 * 60 * 1000; // remind once a day while a problem persists
const FIRST_RUN_DELAY_MS = 60_000;

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
  const config = getSmtpConfig();
  if (!config?.enabled) return;

  try {
    const results = await scanAllHosts();
    const toNotify: { hostName: string; finding: Finding; key: string }[] = [];

    for (const host of results) {
      if (host.error) continue;
      for (const finding of host.findings) {
        if (finding.severity !== "critical" && finding.severity !== "warning") continue;
        const key = `${host.hostId}:${finding.id}`;
        if (shouldNotify(key)) toNotify.push({ hostName: host.hostName, finding, key });
      }
    }

    if (toNotify.length === 0) return;

    const lines = toNotify.map(
      (n) => `- [${n.finding.severity.toUpperCase()}] ${n.hostName} : ${n.finding.title}\n  ${n.finding.detail}`
    );
    const subject = `[Homelab Panel] ${toNotify.length} alerte${toNotify.length > 1 ? "s" : ""} de sécurité`;
    const text = `Le Centre de sécurité a détecté ce qui suit :\n\n${lines.join("\n\n")}\n\nConnecte-toi au panel (page Sécurité) pour appliquer les correctifs proposés.`;

    await sendMail(subject, text);
    for (const n of toNotify) markNotified(n.key);
  } catch {
    // Best-effort: a failed scan or SMTP send shouldn't crash the server, just skip this round.
  }
}

let started = false;

/** Starts the hourly security/update check. Safe to call multiple times — only arms once. */
export function startNotificationScheduler() {
  if (started) return;
  started = true;
  setTimeout(runCheck, FIRST_RUN_DELAY_MS);
  setInterval(runCheck, CHECK_INTERVAL_MS);
}
