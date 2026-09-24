import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/db";
import { startJob, appendJobLog, finishJob } from "@/lib/jobs";
import { unblockIpEverywhere } from "@/lib/firewall";

export async function POST(req: NextRequest) {
  const { ip } = (await req.json()) as { ip?: string };
  if (!ip) return NextResponse.json({ error: "Adresse IP manquante." }, { status: 400 });

  const jobId = startJob("ip-unblock", `Déblocage IP ${ip}`);
  unblockIpEverywhere(ip, (r) => appendJobLog(jobId, `${r.ok ? "✓" : "✗"} ${r.hostName} : ${r.message}\n`))
    .then(() => {
      logAudit("security.unblock_ip_everywhere", undefined, ip);
      finishJob(jobId, "success");
    })
    .catch((err) => {
      appendJobLog(jobId, `Erreur : ${err instanceof Error ? err.message : "échec du déblocage."}\n`);
      finishJob(jobId, "failed");
    });

  return NextResponse.json({ jobId });
}
