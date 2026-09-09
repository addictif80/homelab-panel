import { getDb } from "../db";

function findingKey(hostId: number, findingId: string): string {
  return `${hostId}:${findingId}`;
}

export function ignoreFinding(hostId: number, findingId: string): void {
  getDb()
    .prepare(
      `INSERT INTO security_ignored (finding_key, host_id, finding_id, ignored_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(finding_key) DO UPDATE SET ignored_at = datetime('now')`
    )
    .run(findingKey(hostId, findingId), hostId, findingId);
}

export function unignoreFinding(hostId: number, findingId: string): void {
  getDb().prepare(`DELETE FROM security_ignored WHERE finding_key = ?`).run(findingKey(hostId, findingId));
}

export function listIgnoredKeys(): Set<string> {
  const rows = getDb().prepare(`SELECT finding_key FROM security_ignored`).all() as { finding_key: string }[];
  return new Set(rows.map((r) => r.finding_key));
}
