import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/db";
import { unblockIpEverywhere } from "@/lib/firewall";

export async function POST(req: NextRequest) {
  const { ip } = (await req.json()) as { ip?: string };
  if (!ip) return NextResponse.json({ error: "Adresse IP manquante." }, { status: 400 });

  try {
    const results = await unblockIpEverywhere(ip);
    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    const message = `IP ${ip} débloquée sur ${succeeded.length}/${results.length} machine${results.length > 1 ? "s" : ""}.${
      failed.length > 0 ? ` Échecs : ${failed.map((f) => `${f.hostName} (${f.message})`).join(", ")}` : ""
    }`;
    logAudit("security.unblock_ip_everywhere", undefined, ip);
    return NextResponse.json({ message });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Échec du déblocage." }, { status: 502 });
  }
}
