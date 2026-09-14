import net from "net";
import { getDb } from "../db";
import { resolveHostAddress } from "../ssh";

/**
 * Passive-only "self-audit": the panel connects out to each host on ports that should never
 * answer from outside a trusted admin tool, without ever attempting authentication — so unlike a
 * real intrusion test, it can't trip the host's own fail2ban/IP-ban rules or lock the panel itself
 * out. It verifies exposure, not resistance to brute-force (that would require actually attempting
 * logins, which is exactly the risk this design avoids).
 */
const SENSITIVE_PORTS: { port: number; label: string; severity: "critical" | "warning" }[] = [
  { port: 23, label: "Telnet", severity: "critical" },
  { port: 21, label: "FTP", severity: "warning" },
  { port: 3389, label: "RDP", severity: "critical" },
  { port: 3306, label: "MySQL", severity: "critical" },
  { port: 5432, label: "PostgreSQL", severity: "critical" },
  { port: 6379, label: "Redis", severity: "critical" },
  { port: 27017, label: "MongoDB", severity: "critical" },
  { port: 9200, label: "Elasticsearch", severity: "critical" },
  { port: 2375, label: "API Docker non chiffrée", severity: "critical" },
  { port: 5900, label: "VNC", severity: "warning" },
];

const PROBE_TIMEOUT_MS = 800;

function probePort(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: PROBE_TIMEOUT_MS });
    let settled = false;
    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.on("connect", () => finish(true));
    socket.on("timeout", () => finish(false));
    socket.on("error", () => finish(false));
  });
}

export type PortAuditFinding = {
  hostId: number;
  hostName: string;
  address: string;
  port: number;
  label: string;
  severity: "critical" | "warning";
};

type HostRow = {
  id: number;
  name: string;
  lan_ip: string | null;
  tailscale_ip: string | null;
  public_ip: string | null;
  ssh_port: number;
  ssh_user: string | null;
};

export async function auditHostPorts(hostId: number): Promise<PortAuditFinding[]> {
  const host = getDb().prepare(`SELECT * FROM hosts WHERE id = ?`).get(hostId) as HostRow | undefined;
  if (!host) return [];
  const address = resolveHostAddress(host);
  if (!address) return [];

  const openPorts = await Promise.all(
    SENSITIVE_PORTS.map(async (p) => ({ ...p, open: await probePort(address, p.port) }))
  );

  return openPorts
    .filter((p) => p.open)
    .map(({ port, label, severity }) => ({ hostId: host.id, hostName: host.name, address, port, label, severity }));
}

/** Runs the audit across every host with a resolvable address, in parallel. */
export async function auditAllHosts(): Promise<PortAuditFinding[]> {
  const hosts = getDb().prepare(`SELECT id FROM hosts`).all() as { id: number }[];
  const results = await Promise.all(hosts.map((h) => auditHostPorts(h.id)));
  return results.flat();
}
