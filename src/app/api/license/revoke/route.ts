import { NextResponse } from "next/server";
import { revokeAndReplaceLicense } from "@/lib/license";
import { logAudit } from "@/lib/db";

/** Authenticated (default proxy.ts gate) — a logged-in panel user revoking their own instance's
 * current key and getting a fresh one, in case they suspect it's also in use elsewhere. */
export async function POST() {
  const result = await revokeAndReplaceLicense();
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  logAudit("license.revoked_by_user");
  return NextResponse.json({ ok: true, newKey: result.newKey });
}
