import { NextResponse } from "next/server";
import { pollAllMailLogSources } from "@/lib/mail/mailIngest";

/** "Scanner maintenant" for every enabled source at once, from the Anti-spam mail panel. */
export async function POST() {
  await pollAllMailLogSources();
  return NextResponse.json({ ok: true });
}
