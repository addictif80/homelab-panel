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

export async function vmAction(
  hostId: number,
  node: string,
  type: "qemu" | "lxc",
  vmid: number,
  action: "start" | "stop" | "shutdown" | "reboot"
) {
  return proxmoxRequest(hostId, `/nodes/${node}/${type}/${vmid}/status/${action}`, "POST");
}
