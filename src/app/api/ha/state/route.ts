import { NextResponse } from "next/server";
import { listReplications } from "@/lib/ha";
import { listFailoverConfigs } from "@/lib/npmFailover";
import { getDb } from "@/lib/db";

function hostName(id: number): string {
  const row = getDb().prepare(`SELECT name FROM hosts WHERE id = ?`).get(id) as { name: string } | undefined;
  return row?.name ?? `#${id}`;
}

export type HaStateEntry = {
  replicationId: string;
  name: string;
  proxyHostId: number;
  sourceHostName: string;
  targetHostName: string;
  /** Who nginx is currently sending traffic to, derived from the failover health check — "source"
   * mirrors lastStatus "primary", "target" mirrors "failover". "unknown" covers both a check that
   * hasn't run yet and one that errored (can't tell which side is actually serving from that). */
  servedBy: "source" | "target" | "unknown";
  needsResyncReminder: boolean;
  lastFailbackAt: string | null;
  lastCheckedAt: string | null;
};

/** Only replications with a linked NPM failover have a "who's serving this site" state at all —
 * one with no proxyHostId never had automatic failover wired in, so there's nothing to report. */
export async function GET() {
  const failovers = new Map(listFailoverConfigs().map((f) => [f.proxyHostId, f]));
  const entries: HaStateEntry[] = listReplications()
    .filter((r) => r.proxyHostId !== null)
    .map((r) => {
      const failover = failovers.get(r.proxyHostId!);
      const servedBy = failover?.lastStatus === "primary" ? "source" : failover?.lastStatus === "failover" ? "target" : "unknown";
      return {
        replicationId: r.id,
        name: r.name,
        proxyHostId: r.proxyHostId!,
        sourceHostName: hostName(r.sourceHostId),
        targetHostName: hostName(r.targetHostId),
        servedBy,
        needsResyncReminder: failover?.needsResyncReminder ?? false,
        lastFailbackAt: failover?.lastFailbackAt ?? null,
        lastCheckedAt: failover?.lastCheckedAt ?? null,
      };
    });

  return NextResponse.json({ entries });
}
