import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/db";
import { unblockSenderEverywhere } from "@/lib/mail/senderBlock";

export async function POST(req: NextRequest) {
  const { email } = (await req.json()) as { email?: string };
  if (!email) return NextResponse.json({ error: "Adresse manquante." }, { status: 400 });

  try {
    const results = await unblockSenderEverywhere(email);
    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    const message = `${email} débloqué sur ${succeeded.length}/${results.length} machine${results.length > 1 ? "s" : ""}.${
      failed.length > 0 ? ` Échecs : ${failed.map((f) => `${f.hostName} (${f.message})`).join(", ")}` : ""
    }`;
    logAudit("mail.unblock_sender", email);
    return NextResponse.json({ message });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Échec du déblocage." }, { status: 502 });
  }
}
