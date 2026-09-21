import net from "net";

const PROBE_TIMEOUT_MS = 4000;

// Three independent, unrelated networks (Cloudflare, Google, Quad9) on their DNS-over-TCP port —
// picked because they're about as close to "always up" as a public target gets. A single target
// failing could just be that provider or a route to it, not the panel's own line, so an outage is
// only declared when ALL of them fail in the same tick.
const PROBE_TARGETS: { host: string; port: number }[] = [
  { host: "1.1.1.1", port: 53 },
  { host: "8.8.8.8", port: 53 },
  { host: "9.9.9.9", port: 53 },
];

function probe(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
    socket.connect(port, host);
  });
}

/** True as soon as any one target answers — false only once every target has failed to connect. */
export async function isInternetReachable(): Promise<boolean> {
  const results = await Promise.all(PROBE_TARGETS.map((t) => probe(t.host, t.port)));
  return results.some(Boolean);
}
