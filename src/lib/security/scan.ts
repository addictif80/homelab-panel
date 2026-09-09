import { getDb, logAudit } from "../db";
import { collectHostFacts } from "./facts";
import { analyzeHost } from "./analyze";
import type { HostScanResult } from "./types";

type HostRow = {
  id: number;
  name: string;
  kind: string;
  os: string | null;
  update_method: string | null;
  docker_enabled: number;
  ssh_port: number;
};

function getScannableHosts(): HostRow[] {
  return getDb()
    .prepare(`SELECT id, name, kind, os, update_method, docker_enabled, ssh_port FROM hosts ORDER BY kind, name`)
    .all() as HostRow[];
}

export async function scanHost(host: HostRow): Promise<HostScanResult> {
  try {
    const facts = await collectHostFacts(host.id);
    const findings = analyzeHost(host, facts);
    return { hostId: host.id, hostName: host.name, hostKind: host.kind, hostOs: host.os, findings };
  } catch (err) {
    return {
      hostId: host.id,
      hostName: host.name,
      hostKind: host.kind,
      hostOs: host.os,
      findings: [],
      error: err instanceof Error ? err.message : "Erreur inconnue lors de l'analyse.",
    };
  }
}

export async function scanAllHosts(): Promise<HostScanResult[]> {
  const hosts = getScannableHosts();
  const results = await Promise.all(hosts.map(scanHost));
  logAudit("security.scan_all", undefined, `${results.length} machines analysées`);
  return results;
}

export async function scanSingleHost(hostId: number): Promise<HostScanResult> {
  const host = getDb()
    .prepare(`SELECT id, name, kind, os, update_method, docker_enabled, ssh_port FROM hosts WHERE id = ?`)
    .get(hostId) as HostRow | undefined;
  if (!host) throw new Error("Machine introuvable.");
  const result = await scanHost(host);
  logAudit("security.scan_host", String(hostId));
  return result;
}
