import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/db";
import { startJob, appendJobLog, finishJob } from "@/lib/jobs";
import { blockIpEverywhere } from "@/lib/firewall";
import { blockSenderEverywhere } from "@/lib/mail/senderBlock";

/** Blocks both the connecting IP and the envelope sender address from one mail-log row in a
 * single action — either can be omitted (a record with only one of the two identified). Fans out
 * over every host, which can take a while (each host gets its own SSH connect-with-fallback
 * attempt) — tracked as a background_jobs row so the per-host progress streams in live instead of
 * the button just sitting there until the slowest host times out. */
export async function POST(req: NextRequest) {
  const { ip, email } = (await req.json()) as { ip?: string | null; email?: string | null };
  if (!ip && !email) return NextResponse.json({ error: "Aucune IP ni adresse à bloquer." }, { status: 400 });

  const label = [ip && `IP ${ip}`, email].filter(Boolean).join(" + ");
  const jobId = startJob("mail-block", `Blocage ${label}`);

  (async () => {
    if (ip) {
      appendJobLog(jobId, `--- IP ${ip} ---\n`);
      try {
        await blockIpEverywhere(ip, (r) => appendJobLog(jobId, `${r.ok ? "✓" : "✗"} ${r.hostName} : ${r.message}\n`));
        logAudit("mail.block_ip", ip);
      } catch (err) {
        appendJobLog(jobId, `Erreur : ${err instanceof Error ? err.message : "échec du blocage."}\n`);
      }
    }
    if (email) {
      appendJobLog(jobId, `--- ${email} ---\n`);
      try {
        await blockSenderEverywhere(email, (r) => appendJobLog(jobId, `${r.ok ? "✓" : "✗"} ${r.hostName} : ${r.message}\n`));
        logAudit("mail.block_sender", email);
      } catch (err) {
        appendJobLog(jobId, `Erreur : ${err instanceof Error ? err.message : "échec du blocage."}\n`);
      }
    }
    finishJob(jobId, "success");
  })().catch((err) => {
    appendJobLog(jobId, `\nErreur inattendue : ${err instanceof Error ? err.message : "inconnue"}\n`);
    finishJob(jobId, "failed");
  });

  return NextResponse.json({ jobId });
}
