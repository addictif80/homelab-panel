import { NextResponse } from "next/server";
import { Socket } from "net";
import { getDb } from "@/lib/db";
import { resolveHostAddress } from "@/lib/ssh";
import type { Host } from "../../route";

function tcpProbe(host: string, port: number, timeoutMs = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const host = getDb().prepare(`SELECT * FROM hosts WHERE id = ?`).get(id) as Host | undefined;
  if (!host) return NextResponse.json({ error: "Machine introuvable." }, { status: 404 });

  const address = resolveHostAddress(host);
  if (!address) {
    return NextResponse.json({ reachable: null, reason: "Aucune adresse IP renseignée." });
  }

  const reachable = await tcpProbe(address, host.ssh_port || 22);
  return NextResponse.json({ reachable, address, port: host.ssh_port || 22 });
}
