import { randomUUID } from "crypto";
import { getDb } from "./db";

export type DirectoryStatus = "none" | "pending" | "approved" | "rejected";

export type ServiceLink = {
  id: string;
  name: string;
  url: string;
  faviconDataUrl: string | null;
  showPublic: boolean;
  clickCount: number;
  directoryOptIn: boolean;
  directoryStatus: DirectoryStatus;
  directorySubmissionId: string | null;
  createdAt: string;
};

type ServiceLinkRow = {
  id: string;
  name: string;
  url: string;
  favicon_data_url: string | null;
  show_public: number;
  click_count: number;
  directory_opt_in: number;
  directory_status: DirectoryStatus;
  directory_submission_id: string | null;
  created_at: string;
};

function rowToLink(row: ServiceLinkRow): ServiceLink {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    faviconDataUrl: row.favicon_data_url,
    showPublic: !!row.show_public,
    clickCount: row.click_count,
    directoryOptIn: !!row.directory_opt_in,
    directoryStatus: row.directory_status,
    directorySubmissionId: row.directory_submission_id,
    createdAt: row.created_at,
  };
}

export function listServiceLinks(): ServiceLink[] {
  return (getDb().prepare(`SELECT * FROM service_links ORDER BY created_at ASC`).all() as ServiceLinkRow[]).map(
    rowToLink
  );
}

export function listPublicServiceLinks(): ServiceLink[] {
  return (
    getDb().prepare(`SELECT * FROM service_links WHERE show_public = 1 ORDER BY created_at ASC`).all() as ServiceLinkRow[]
  ).map(rowToLink);
}

export function getServiceLink(id: string): ServiceLink | null {
  const row = getDb().prepare(`SELECT * FROM service_links WHERE id = ?`).get(id) as ServiceLinkRow | undefined;
  return row ? rowToLink(row) : null;
}

const FAVICON_TIMEOUT_MS = 5000;
const FAVICON_MAX_BYTES = 500_000;

/**
 * Fetches and caches the favicon as a data URL rather than storing (and later hotlinking) the raw
 * remote URL: a visitor to the public board has no reason to be able to reach an internal-only
 * service's own origin to load its icon, and the panel itself always can. Best-effort — any
 * failure (unreachable host, self-signed cert, no favicon, oversized file) just means no icon.
 */
export async function fetchFavicon(pageUrl: string): Promise<string | null> {
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FAVICON_TIMEOUT_MS);
  try {
    const res = await fetch(`${origin}/favicon.ico`, { signal: controller.signal });
    if (!res.ok) return null;
    const contentLength = Number(res.headers.get("content-length") || "0");
    if (contentLength > FAVICON_MAX_BYTES) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > FAVICON_MAX_BYTES) return null;
    const contentType = res.headers.get("content-type") || "image/x-icon";
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function createServiceLink(input: { name: string; url: string; faviconDataUrl: string | null; showPublic: boolean }): ServiceLink {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO service_links (id, name, url, favicon_data_url, show_public) VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, input.name, input.url, input.faviconDataUrl, input.showPublic ? 1 : 0);
  return getServiceLink(id)!;
}

export function updateServiceLink(
  id: string,
  input: Partial<{ name: string; url: string; faviconDataUrl: string | null; showPublic: boolean }>
): ServiceLink | null {
  const current = getServiceLink(id);
  if (!current) return null;
  getDb()
    .prepare(`UPDATE service_links SET name = ?, url = ?, favicon_data_url = ?, show_public = ? WHERE id = ?`)
    .run(
      input.name ?? current.name,
      input.url ?? current.url,
      input.faviconDataUrl !== undefined ? input.faviconDataUrl : current.faviconDataUrl,
      (input.showPublic ?? current.showPublic) ? 1 : 0,
      id
    );
  return getServiceLink(id);
}

export function deleteServiceLink(id: string): void {
  getDb().prepare(`DELETE FROM service_links WHERE id = ?`).run(id);
}

export function setServiceLinkDirectoryState(
  id: string,
  state: { optIn: boolean; status: DirectoryStatus; submissionId: string | null }
): void {
  getDb()
    .prepare(
      `UPDATE service_links SET directory_opt_in = ?, directory_status = ?, directory_submission_id = ? WHERE id = ?`
    )
    .run(state.optIn ? 1 : 0, state.status, state.submissionId, id);
}

export function incrementServiceLinkClick(id: string): number | null {
  const result = getDb()
    .prepare(`UPDATE service_links SET click_count = click_count + 1 WHERE id = ?`)
    .run(id);
  if (result.changes === 0) return null;
  return getServiceLink(id)?.clickCount ?? null;
}
