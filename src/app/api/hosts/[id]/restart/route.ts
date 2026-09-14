import { NextResponse } from "next/server";
import { runSshCommand } from "@/lib/ssh";
import { withTimeout } from "@/lib/timeout";
import { logAudit } from "@/lib/db";

const RESTART_TIMEOUT_MS = 15_000;

/**
 * Detaches the reboot from the SSH session (`nohup ... &`, one second of delay) so the command
 * can return a clean exit code before the connection is severed by the actual shutdown — a plain
 * `reboot` in the foreground races the SSH session dying against the exit status ever arriving.
 */
const RESTART_COMMAND = "nohup bash -c 'sleep 1; reboot' >/dev/null 2>&1 &";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hostId = Number(id);

  try {
    const { code, stderr } = await withTimeout(
      runSshCommand(hostId, RESTART_COMMAND, { sudo: true }),
      RESTART_TIMEOUT_MS,
      "Délai dépassé lors de la demande de redémarrage."
    );
    if (code !== 0) throw new Error(stderr.trim() || "Échec de la commande de redémarrage.");
    logAudit("host.restart", String(hostId));
    return NextResponse.json({ message: "Redémarrage lancé. La machine sera injoignable pendant quelques instants." });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
