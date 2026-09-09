import https from "https";
import { getDb } from "./db";
import { vaultDecrypt } from "./crypto";
import { resolveHostAddress } from "./ssh";

type ProxmoxTokenConfig = {
  tokenId: string; // e.g. "root@pam!homelab"
  secret: string;
  port?: number;
  verifySsl?: boolean;
};

type HostRow = {
  id: number;
  lan_ip: string | null;
  tailscale_ip: string | null;
  public_ip: string | null;
  ssh_port: number;
  ssh_user: string | null;
};

export function getProxmoxConfig(hostId: number): ProxmoxTokenConfig | null {
  const cred = getDb()
    .prepare(
      `SELECT encrypted_data FROM credentials WHERE host_id = ? AND kind = 'api_token' AND label = 'proxmox' ORDER BY created_at DESC LIMIT 1`
    )
    .get(hostId) as { encrypted_data: string } | undefined;
  if (!cred) return null;
  return JSON.parse(vaultDecrypt(cred.encrypted_data));
}

function proxmoxRequest(
  hostId: number,
  path: string,
  method = "GET",
  body?: URLSearchParams
): Promise<unknown> {
  const host = getDb().prepare(`SELECT * FROM hosts WHERE id = ?`).get(hostId) as HostRow | undefined;
  if (!host) throw new Error("Machine introuvable.");
  const address = resolveHostAddress(host);
  if (!address) throw new Error("Aucune adresse IP pour ce nœud Proxmox.");

  const config = getProxmoxConfig(hostId);
  if (!config) throw new Error("Aucun token API Proxmox configuré pour ce nœud.");

  const port = config.port || 8006;
  const payload = body ? body.toString() : undefined;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: address,
        port,
        path: `/api2/json${path}`,
        method,
        rejectUnauthorized: config.verifySsl ?? false,
        headers: {
          Authorization: `PVEAPIToken=${config.tokenId}=${config.secret}`,
          ...(payload
            ? {
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
        },
        timeout: 10_000,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`Proxmox API ${res.statusCode}: ${raw || res.statusMessage}`));
            return;
          }
          try {
            resolve(JSON.parse(raw).data);
          } catch {
            reject(new Error("Réponse Proxmox invalide."));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("Timeout de connexion à Proxmox.")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export type ProxmoxResource = {
  vmid: number;
  node: string;
  type: "qemu" | "lxc";
  name: string;
  status: string;
  cpu: number;
  mem: number;
  maxmem: number;
  uptime: number;
};

export async function listResources(hostId: number): Promise<ProxmoxResource[]> {
  const data = await proxmoxRequest(hostId, "/cluster/resources?type=vm");
  return data as ProxmoxResource[];
}

/** Any host in the DB with a Proxmox API token configured — used to reach the cluster API when
 * a specific node (e.g. one without its own token) needs to be queried, since Proxmox nodes in
 * the same cluster transparently proxy requests for each other's node-scoped paths. */
export function findAnyProxmoxCredentialHostId(): number | null {
  const row = getDb()
    .prepare(`SELECT host_id FROM credentials WHERE kind = 'api_token' AND label = 'proxmox' LIMIT 1`)
    .get() as { host_id: number } | undefined;
  return row?.host_id ?? null;
}

type ProxmoxStorageEntry = {
  storage: string;
  type: string;
  total: number;
  used: number;
  avail: number;
  enabled: number;
  active: number;
};

/** Real disk usage for a Proxmox node, including LVM-thin/ZFS pools that aren't mounted
 * filesystems and so are invisible to `df` — summed across every storage backend it reports. */
export async function getNodeStorageTotals(
  credentialHostId: number,
  node: string
): Promise<{ totalBytes: number; usedBytes: number }> {
  const data = (await proxmoxRequest(credentialHostId, `/nodes/${node}/storage`)) as ProxmoxStorageEntry[];
  let totalBytes = 0;
  let usedBytes = 0;
  for (const entry of data) {
    if (!entry.active) continue;
    totalBytes += entry.total || 0;
    usedBytes += entry.used || 0;
  }
  return { totalBytes, usedBytes };
}

type ProxmoxNodeStatus = {
  cpu: number; // fraction 0-1
  memory: { total: number; used: number };
  cpuinfo?: { cpus: number };
};

/** CPU/RAM for a Proxmox node straight from Proxmox's own accounting — more reliable than
 * parsing `top` over SSH, and works even when no SSH credential is on file for that node. */
export async function getNodeStatus(
  credentialHostId: number,
  node: string
): Promise<{ cpuUsedPercent: number; memTotalMb: number; memUsedMb: number; cores: number | null }> {
  const data = (await proxmoxRequest(credentialHostId, `/nodes/${node}/status`)) as ProxmoxNodeStatus;
  return {
    cpuUsedPercent: (data.cpu || 0) * 100,
    memTotalMb: data.memory.total / 1024 / 1024,
    memUsedMb: data.memory.used / 1024 / 1024,
    cores: data.cpuinfo?.cpus ?? null,
  };
}

export async function vmAction(
  hostId: number,
  node: string,
  type: "qemu" | "lxc",
  vmid: number,
  action: "start" | "stop" | "shutdown" | "reboot"
) {
  return proxmoxRequest(hostId, `/nodes/${node}/${type}/${vmid}/status/${action}`, "POST");
}
