import { NextRequest, NextResponse } from "next/server";
import { activateWithKey } from "@/lib/license";
import { logAudit } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { key } = (await req.json()) as { key?: string };
  if (!key) return NextResponse.json({ error: "Clé requise." }, { status: 400 });

  const result = await activateWithKey(key);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  logAudit("license.activated");
  return NextResponse.json({ ok: true });
}
