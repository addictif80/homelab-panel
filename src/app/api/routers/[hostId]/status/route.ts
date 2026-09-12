import { NextRequest, NextResponse } from "next/server";
import { getRouterClient } from "@/lib/routers";
import { getDb } from "@/lib/db";
import { isValidIpv4 } from "@/lib/validators";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  try {
    const status = await getRouterClient(Number(hostId)).getStatus();
    // The box already tells us its own WAN IP — save the round trip of asking the admin to type
    // it into the inventory by hand, and keep it current as it changes (dynamic IP, ISP renewal).
    if (status.wanIp && isValidIpv4(status.wanIp)) {
      getDb()
        .prepare(`UPDATE hosts SET public_ip = ? WHERE id = ? AND public_ip IS NOT ?`)
        .run(status.wanIp, hostId, status.wanIp);
    }
    return NextResponse.json({ status });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
