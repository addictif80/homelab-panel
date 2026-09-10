import { randomUUID } from "crypto";
import { getDb } from "../db";

export type Release = { id: string; version: string; changelog: string; createdAt: string };

type ReleaseRow = { id: string; version: string; changelog: string; created_at: string };

function rowToRelease(row: ReleaseRow): Release {
  return { id: row.id, version: row.version, changelog: row.changelog, createdAt: row.created_at };
}

export function listReleases(): Release[] {
  return (getDb().prepare(`SELECT * FROM releases ORDER BY created_at DESC`).all() as ReleaseRow[]).map(rowToRelease);
}

export function getLatestRelease(): Release | null {
  const row = getDb().prepare(`SELECT * FROM releases ORDER BY created_at DESC LIMIT 1`).get() as
    | ReleaseRow
    | undefined;
  return row ? rowToRelease(row) : null;
}

export function publishRelease(version: string, changelog: string): Release {
  const id = randomUUID();
  getDb().prepare(`INSERT INTO releases (id, version, changelog) VALUES (?, ?, ?)`).run(id, version, changelog);
  return getLatestRelease()!;
}

/** Any key ever issued for a real sale counts as proof of purchase for downloading an update —
 * unlike activation, checking for an update doesn't consume the key, it can be used indefinitely
 * by the one instance that already activated with it. */
export function isKnownLicenseKey(key: string): boolean {
  const row = getDb().prepare(`SELECT 1 FROM license_keys WHERE key = ?`).get(key);
  return !!row;
}
