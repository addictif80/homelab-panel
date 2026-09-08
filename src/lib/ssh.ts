import { getDb } from "./db";
import { vaultDecrypt } from "./crypto";
import type { ConnectConfig } from "ssh2";

type CredentialRow = {
  id: number;
  kind: "ssh_key" | "ssh_password" | "api_token";
  label: string | null;
  encrypted_data: string;
};

type HostRow = {
  id: number;
  lan_ip: string | null;
  tailscale_ip: string | null;
  public_ip: string | null;
  ssh_port: number;
  ssh_user: string | null;
};

export function resolveHostAddress(host: HostRow): string | null {
  return host.lan_ip || host.tailscale_ip || host.public_ip || null;
}

/** Builds an ssh2 ConnectConfig for a host, using its most recent SSH credential from the vault. */
export function buildSshConfig(hostId: number): ConnectConfig {
  const db = getDb();
  const host = db.prepare(`SELECT * FROM hosts WHERE id = ?`).get(hostId) as HostRow | undefined;
  if (!host) throw new Error("Machine introuvable.");

  const address = resolveHostAddress(host);
  if (!address) throw new Error("Aucune adresse IP renseignée pour cette machine.");

  const cred = db
    .prepare(
      `SELECT * FROM credentials WHERE host_id = ? AND kind IN ('ssh_key','ssh_password') ORDER BY created_at DESC LIMIT 1`
    )
    .get(hostId) as CredentialRow | undefined;
  if (!cred) throw new Error("Aucun identifiant SSH enregistré pour cette machine.");

  const secret = vaultDecrypt(cred.encrypted_data);
  const base: ConnectConfig = {
    host: address,
    port: host.ssh_port || 22,
    username: host.ssh_user || "root",
    readyTimeout: 10_000,
  };

  if (cred.kind === "ssh_key") {
    return { ...base, privateKey: secret };
  }
  return { ...base, password: secret };
}
