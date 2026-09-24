import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/db";
import { startJob, appendJobLog, finishJob } from "@/lib/jobs";
import { unblockSenderEverywhere } from "@/lib/mail/senderBlock";

export async function POST(req: NextRequest) {
  const { email } = (await req.json()) as { email?: string };
  if (!email) return NextResponse.json({ error: "Adresse manquante." }, { status: 400 });

  const jobId = startJob("sender-unblock", `Déblocage ${email}`);
  unblockSenderEverywhere(email, (r) => appendJobLog(jobId, `${r.ok ? "✓" : "✗"} ${r.hostName} : ${r.message}\n`))
    .then(() => {
      logAudit("mail.unblock_sender", email);
      finishJob(jobId, "success");
    })
    .catch((err) => {
      appendJobLog(jobId, `Erreur : ${err instanceof Error ? err.message : "échec du déblocage."}\n`);
      finishJob(jobId, "failed");
    });

  return NextResponse.json({ jobId });
}
