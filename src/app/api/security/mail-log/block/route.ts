import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/db";
import { blockIpEverywhere, type BlockEverywhereResult } from "@/lib/firewall";
import { blockSenderEverywhere, type SenderBlockResult } from "@/lib/mail/senderBlock";

/** Turns a per-host results array into "bloquée sur 2/3 machines : a, b. Échec sur c (raison)." —
 * the machine names are the whole point (a raw "2/3" count doesn't say which host still lets the
 * traffic through), and a failure's reason is kept short by name rather than dumped raw. */
function summarize(label: string, results: (BlockEverywhereResult | SenderBlockResult)[]): string {
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  let text = `${label} sur ${ok.length}/${results.length} machine${results.length > 1 ? "s" : ""}`;
  text += ok.length > 0 ? ` : ${ok.map((r) => r.hostName).join(", ")}.` : ".";
  if (failed.length > 0) {
    text += ` Échec sur ${failed.map((r) => `${r.hostName} (${r.message})`).join(", ")}.`;
  }
  return text;
}

/** Blocks both the connecting IP and the envelope sender address from one mail-log row in a
 * single action — either can be omitted (a record with only one of the two identified). */
export async function POST(req: NextRequest) {
  const { ip, email } = (await req.json()) as { ip?: string | null; email?: string | null };
  if (!ip && !email) return NextResponse.json({ error: "Aucune IP ni adresse à bloquer." }, { status: 400 });

  const messages: string[] = [];

  if (ip) {
    try {
      const results = await blockIpEverywhere(ip);
      messages.push(summarize(`IP ${ip} bloquée`, results));
      logAudit("mail.block_ip", ip);
    } catch (err) {
      messages.push(`IP ${ip} : ${err instanceof Error ? err.message : "échec du blocage."}`);
    }
  }

  if (email) {
    try {
      const results = await blockSenderEverywhere(email);
      messages.push(summarize(`${email} traité`, results));
      logAudit("mail.block_sender", email);
    } catch (err) {
      messages.push(`${email} : ${err instanceof Error ? err.message : "échec du blocage."}`);
    }
  }

  return NextResponse.json({ message: messages.join(" ") });
}
