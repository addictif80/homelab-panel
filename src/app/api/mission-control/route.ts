import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getFleetPulse } from "@/lib/pulse";
import { getRiskScoreHistory } from "@/lib/security/riskScore";
import { detectRecentIncidents } from "@/lib/incidentStory";

type HostNameRow = { id: number; name: string };
type AuditRow = { action: string; target: string | null; created_at: string };

/** One aggregation point for the wallboard-style /mission-control screen — everything it needs in
 * a single request rather than the page firing off half a dozen separate fetches every refresh
 * tick, which would multiply load on every poll for no benefit (nothing here needs independent
 * refresh timing). */
export async function GET() {
  const db = getDb();
  const hostNames = db.prepare(`SELECT id, name FROM hosts`).all() as HostNameRow[];
  const nameById = new Map(hostNames.map((h) => [h.id, h.name]));

  const pulses = await getFleetPulse();
  const fleet = pulses
    .filter((p) => p.configured)
    .map((p) => ({ hostId: p.hostId, hostName: nameById.get(p.hostId) ?? `#${p.hostId}`, reachable: p.reachable, latencyMs: p.latencyMs }));
  const downHosts = fleet.filter((h) => !h.reachable);

  const riskHistory = getRiskScoreHistory(7);
  const riskScore = riskHistory.at(-1)?.score ?? null;

  const incidents = detectRecentIncidents(1);

  const stalePlanCount = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM backup_plans p WHERE p.enabled = 1 AND p.schedule != 'manual'
         AND NOT EXISTS (
           SELECT 1 FROM backup_runs r WHERE r.plan_id = p.id AND r.status = 'success'
           AND r.started_at > datetime('now', '-2 days')
         )`
      )
      .get() as { c: number }
  ).c;
  const totalActivePlans = (db.prepare(`SELECT COUNT(*) as c FROM backup_plans WHERE enabled = 1`).get() as { c: number }).c;

  const recentActivity = (
    db.prepare(`SELECT action, target, created_at FROM audit_log ORDER BY created_at DESC LIMIT 15`).all() as AuditRow[]
  ).map((r) => ({ action: r.action, target: r.target, createdAt: r.created_at }));

  return NextResponse.json({
    fleet,
    downHosts,
    riskScore,
    incidentCount: incidents.length,
    stalePlanCount,
    totalActivePlans,
    recentActivity,
    generatedAt: new Date().toISOString(),
  });
}
