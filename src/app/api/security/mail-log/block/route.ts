import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/db";
import { blockIpEverywhere } from "@/lib/firewall";
import { blockSenderEverywhere } from "@/lib/mail/senderBlock";

/** Blocks both the connecting IP and the envelope sender address from one mail-log row in a
 * single action — either can be omitted (a record with only one of the two identified). */
export async function POST(req: NextRequest) {
  const { ip, email } = (await req.json()) as { ip?: string | null; email?: string | null };
  if (!ip && !email) return NextResponse.json({ error: "Aucune IP ni adresse à bloquer." }, { status: 400 });

  const messages: string[] = [];

  if (ip) {
    try {
      const results = await blockIpEverywhere(ip);
      const ok = results.filter((r) => r.ok).length;
      messages.push(`IP ${ip} bloquée sur ${ok}/${results.length} machine${results.length > 1 ? "s" : ""}.`);
      logAudit("mail.block_ip", ip);
    } catch (err) {
      messages.push(`IP ${ip} : ${err instanceof Error ? err.message : "échec du blocage."}`);
    }
  }

  if (email) {
    try {
      const results = await blockSenderEverywhere(email);
      const ok = results.filter((r) => r.ok).length;
      messages.push(`${email} traité sur ${ok}/${results.length} machine${results.length > 1 ? "s" : ""}.`);
      logAudit("mail.block_sender", email);
    } catch (err) {
      messages.push(`${email} : ${err instanceof Error ? err.message : "échec du blocage."}`);
    }
  }

  return NextResponse.json({ message: messages.join(" ") });
}
