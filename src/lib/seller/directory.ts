import { randomUUID } from "crypto";
import { getDb } from "../db";
import { getKeyInstanceBinding, bindKeyInstanceId } from "./licenseKeys";

export type DirectorySubmissionStatus = "pending" | "approved" | "rejected";

export type DirectorySubmission = {
  id: string;
  licenseKey: string;
  instanceId: string;
  ownerName: string;
  serviceName: string;
  serviceUrl: string;
  faviconDataUrl: string | null;
  status: DirectorySubmissionStatus;
  createdAt: string;
  reviewedAt: string | null;
};

type SubmissionRow = {
  id: string;
  license_key: string;
  instance_id: string;
  owner_name: string;
  service_name: string;
  service_url: string;
  favicon_data_url: string | null;
  status: DirectorySubmissionStatus;
  created_at: string;
  reviewed_at: string | null;
};

function rowToSubmission(row: SubmissionRow): DirectorySubmission {
  return {
    id: row.id,
    licenseKey: row.license_key,
    instanceId: row.instance_id,
    ownerName: row.owner_name,
    serviceName: row.service_name,
    serviceUrl: row.service_url,
    faviconDataUrl: row.favicon_data_url,
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

export function listDirectorySubmissions(): DirectorySubmission[] {
  return (
    getDb().prepare(`SELECT * FROM directory_submissions ORDER BY created_at DESC`).all() as SubmissionRow[]
  ).map(rowToSubmission);
}

export function listApprovedDirectoryEntries(): DirectorySubmission[] {
  return (
    getDb()
      .prepare(`SELECT * FROM directory_submissions WHERE status = 'approved' ORDER BY reviewed_at DESC`)
      .all() as SubmissionRow[]
  ).map(rowToSubmission);
}

export function getDirectorySubmission(id: string): DirectorySubmission | null {
  const row = getDb().prepare(`SELECT * FROM directory_submissions WHERE id = ?`).get(id) as
    | SubmissionRow
    | undefined;
  return row ? rowToSubmission(row) : null;
}

export type LicenseCheckResult = { ok: true } | { ok: false; error: string; status: number };

/** Same "activated + instance matches (or first-claims) the binding" check used by
 * /api/seller/license/refresh — the only credential a public endpoint like this has is the license
 * key text plus the instanceId, so a key that was never activated, or is bound to a different
 * instance, must be rejected the same way there. */
export function checkLicenseForDirectory(key: string, instanceId: string): LicenseCheckResult {
  const binding = getKeyInstanceBinding(key);
  if (!binding) return { ok: false, error: "Clé inconnue.", status: 400 };
  if (!binding.usedAt) return { ok: false, error: "Cette clé n'a jamais été activée.", status: 400 };

  if (binding.instanceId) {
    if (binding.instanceId !== instanceId) {
      return { ok: false, error: "Cette clé est liée à une autre installation.", status: 403 };
    }
  } else {
    bindKeyInstanceId(key, instanceId);
  }
  return { ok: true };
}

/** Upserts on (license_key, instance_id, service_url) — resubmitting an edited service (different
 * name/favicon at the same URL) always goes back to 'pending' rather than silently staying
 * approved, since an admin approved the *previous* content, not whatever it might change to next. */
export function upsertDirectorySubmission(input: {
  licenseKey: string;
  instanceId: string;
  ownerName: string;
  serviceName: string;
  serviceUrl: string;
  faviconDataUrl: string | null;
}): DirectorySubmission {
  const existing = getDb()
    .prepare(`SELECT id FROM directory_submissions WHERE license_key = ? AND instance_id = ? AND service_url = ?`)
    .get(input.licenseKey, input.instanceId, input.serviceUrl) as { id: string } | undefined;

  const id = existing?.id ?? randomUUID();
  getDb()
    .prepare(
      `INSERT INTO directory_submissions (id, license_key, instance_id, owner_name, service_name, service_url, favicon_data_url, status, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL)
       ON CONFLICT(license_key, instance_id, service_url) DO UPDATE SET
         owner_name = excluded.owner_name,
         service_name = excluded.service_name,
         favicon_data_url = excluded.favicon_data_url,
         status = 'pending',
         reviewed_at = NULL`
    )
    .run(id, input.licenseKey, input.instanceId, input.ownerName, input.serviceName, input.serviceUrl, input.faviconDataUrl);

  return getDirectorySubmission(id)!;
}

/** Ownership-checked: only removable by the same (license_key, instance_id) that created it, so
 * a submissionId alone (learned from, say, a shared screenshot) can't be used to delete someone
 * else's directory entry. */
export function withdrawDirectorySubmission(id: string, licenseKey: string, instanceId: string): boolean {
  const result = getDb()
    .prepare(`DELETE FROM directory_submissions WHERE id = ? AND license_key = ? AND instance_id = ?`)
    .run(id, licenseKey, instanceId);
  return result.changes > 0;
}

export function reviewDirectorySubmission(id: string, status: "approved" | "rejected"): DirectorySubmission | null {
  const result = getDb()
    .prepare(`UPDATE directory_submissions SET status = ?, reviewed_at = datetime('now') WHERE id = ?`)
    .run(status, id);
  if (result.changes === 0) return null;
  return getDirectorySubmission(id);
}

export function deleteDirectorySubmission(id: string): void {
  getDb().prepare(`DELETE FROM directory_submissions WHERE id = ?`).run(id);
}
