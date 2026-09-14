import { getDb } from "../db";

/** Records the first time this machine fingerprint was ever seen, idempotently — repeat calls
 * from the same install just read back the original date. Wiping the client's local database (and
 * therefore its trial_started_at) can't roll this back, since the fingerprint is derived from the
 * host itself, not from anything stored in the panel's own database. */
export function registerTrialFingerprint(fingerprint: string): string {
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO trial_fingerprints (fingerprint) VALUES (?)`).run(fingerprint);
  const row = db.prepare(`SELECT first_seen_at FROM trial_fingerprints WHERE fingerprint = ?`).get(fingerprint) as {
    first_seen_at: string;
  };
  return row.first_seen_at;
}
