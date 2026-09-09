import { Client as SshClient } from "ssh2";
import { getDb } from "./db";
import { vaultDecrypt } from "./crypto";
import type { ConnectConfig } from "ssh2";

type CredentialRow = {
  id: number;
  kind: "ssh_key" | "ssh_password" | "sudo_password" | "api_token";
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
  needs_sudo?: number;
};

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// The panel itself runs on a remote VM (not on the home LAN), so a Tailscale address — reachable
// from anywhere on the tailnet — is tried before the LAN IP, which only works if the panel
// happens to be colocated on the same local network as the target machine.
export function resolveHostAddress(host: HostRow): string | null {
  return host.tailscale_ip || host.lan_ip || host.public_ip || null;
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

function getHostRow(hostId: number): HostRow {
  const host = getDb().prepare(`SELECT * FROM hosts WHERE id = ?`).get(hostId) as HostRow | undefined;
  if (!host) throw new Error("Machine introuvable.");
  return host;
}

/**
 * Password used for `sudo -S` on this host: a dedicated "sudo_password" credential if one was
 * added, otherwise the SSH login password (the common case where both are the same).
 */
export function resolveSudoPassword(hostId: number): string | null {
  const db = getDb();
  const dedicated = db
    .prepare(
      `SELECT encrypted_data FROM credentials WHERE host_id = ? AND kind = 'sudo_password' ORDER BY created_at DESC LIMIT 1`
    )
    .get(hostId) as { encrypted_data: string } | undefined;
  if (dedicated) return vaultDecrypt(dedicated.encrypted_data);

  const loginPassword = db
    .prepare(
      `SELECT encrypted_data FROM credentials WHERE host_id = ? AND kind = 'ssh_password' ORDER BY created_at DESC LIMIT 1`
    )
    .get(hostId) as { encrypted_data: string } | undefined;
  return loginPassword ? vaultDecrypt(loginPassword.encrypted_data) : null;
}

/**
 * Password to auto-type into an interactive shell right after connecting, so a host marked
 * "needs sudo" drops the user straight into a root session instead of making them run
 * `sudo -i` and retype a password we already have in the vault. Null when the host doesn't
 * need it or no password is on file.
 */
export function getAutoElevatePassword(hostId: number): string | null {
  const host = getHostRow(hostId);
  if (!host.needs_sudo) return null;
  return resolveSudoPassword(hostId);
}

/**
 * Wraps a command with `sudo -S` when the host is configured to need it (the common case here:
 * password-only SSH login, then `sudo -i` for anything privileged like apt or docker). Returns
 * the password to feed on the exec channel's stdin right after starting it, since `sudo -S`
 * reads the password from stdin instead of prompting a real TTY.
 */
export function buildPrivilegedCommand(
  hostId: number,
  rawCommand: string
): { command: string; stdinPassword: string | null } {
  const host = getHostRow(hostId);
  if (!host.needs_sudo) return { command: rawCommand, stdinPassword: null };

  const password = resolveSudoPassword(hostId);
  if (!password) {
    throw new Error(
      "Cette machine nécessite sudo mais aucun mot de passe n'est enregistré. Ajoute un identifiant SSH par mot de passe (ou un mot de passe sudo dédié)."
    );
  }
  return {
    command: `sudo -S -p '' bash -lc ${shellQuote(rawCommand)}`,
    stdinPassword: password,
  };
}

export type SshExecResult = { stdout: string; stderr: string; code: number };

/**
 * Runs a command over SSH and buffers its output. Pass `sudo: true` for commands that need
 * root (apt, docker) on a host configured with `needs_sudo` — the password is fed on stdin
 * automatically. Leave it false for read-only commands (stats, log tailing) that don't need it.
 */
export function runSshCommand(hostId: number, rawCommand: string, opts: { sudo?: boolean } = {}): Promise<SshExecResult> {
  const config = buildSshConfig(hostId);
  const { command, stdinPassword } = opts.sudo
    ? buildPrivilegedCommand(hostId, rawCommand)
    : { command: rawCommand, stdinPassword: null as string | null };
  const conn = new SshClient();

  return new Promise((resolve, reject) => {
    conn.on("ready", () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          conn.end();
          reject(err);
          return;
        }
        if (stdinPassword) stream.write(`${stdinPassword}\n`);
        let stdout = "";
        let stderr = "";
        stream.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
        stream.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
        stream.on("close", (code: number) => {
          conn.end();
          resolve({ stdout, stderr, code });
        });
      });
    });
    conn.on("error", reject);
    conn.connect(config);
  });
}
