import { NextResponse } from "next/server";
import { getFailoverDefaults } from "@/lib/npmFailover";

/** Read-only lookup, for prefilling the "failover par défaut" form with whatever was last applied
 * — the actual save-and-apply happens through the apply-all route below. */
export async function GET() {
  return NextResponse.json({ defaults: getFailoverDefaults() });
}
