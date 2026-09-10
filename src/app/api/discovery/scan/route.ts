import { NextRequest, NextResponse } from "next/server";
import { scanLan, listKnownLanIps } from "@/lib/discovery";
import { logAudit } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { hostId } = await req.json();
  if (!hostId) return NextResponse.json({ error: "Machine scanneuse requise." }, { status: 400 });

  try {
    const devices = await scanLan(Number(hostId));
    const known = listKnownLanIps();
    const knownIps = new Set(known.map((h) => h.lan_ip));
    const results = devices
      .map((d) => ({ ...d, known: knownIps.has(d.ip) }))
      .sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
    logAudit("discovery.scan", String(hostId), `${results.length} appareils`);
    return NextResponse.json({ devices: results });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur de scan." },
      { status: 502 }
    );
  }
}
