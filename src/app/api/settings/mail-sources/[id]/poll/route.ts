import { NextRequest, NextResponse } from "next/server";
import { listMailLogSources, pollMailLogSource } from "@/lib/mail/mailIngest";

/** "Scanner maintenant" for a single source — reads whatever's new since its cursor right away,
 * instead of waiting up to 2 minutes for the background scheduler's next tick. Same function the
 * scheduler itself calls, so a manual scan behaves identically (same timeout, same error
 * handling, same cursor advance) rather than being a special-cased shortcut. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const source = listMailLogSources().find((s) => s.id === id);
  if (!source) return NextResponse.json({ error: "Source introuvable." }, { status: 404 });

  const inserted = await pollMailLogSource(source);
  const updated = listMailLogSources().find((s) => s.id === id);
  return NextResponse.json({ inserted, lastError: updated?.lastError ?? null });
}
