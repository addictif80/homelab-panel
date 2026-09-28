import { NextResponse } from "next/server";
import { clearResyncReminder } from "@/lib/npmFailover";
import { logAudit } from "@/lib/db";

/** Manually clears a failback-resync reminder — for when the user already checked and confirmed
 * no resync was actually needed, without running an actual reverse sync (which also clears it, see
 * lib/ha's runReverseSync). */
export async function POST(_req: Request, { params }: { params: Promise<{ proxyHostId: string }> }) {
  const { proxyHostId } = await params;
  clearResyncReminder(Number(proxyHostId));
  logAudit("npm.failover_resync_reminder_dismissed", proxyHostId);
  return NextResponse.json({ ok: true });
}
