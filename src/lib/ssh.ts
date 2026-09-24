import { Client as SshClient } from "ssh2";
import { getDb } from "./db";
import { vaultDecrypt } from "./crypto";
import type { ConnectConfig } from "ssh2";
import { isDemoContext } from "./demo/context";
import { fakeExec } from "./demo/fakeExec";

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

/** Every address configured for a host, in the same preference order as resolveHostAddress, but
 * kept as a list instead of collapsing to just the first one — see connectSsh below for why. */
function candidateAddresses(host: HostRow): string[] {
  return Array.from(new Set([host.tailscale_ip, host.lan_ip, host.public_ip].filter((a): a is string => !!a)));
}

export type HostConnectionInfo = { address: string; port: number; user: string };

/** Address/port/user for a host, for building remote targets (e.g. `user@host` for rsync)
 * outside of ssh2's own ConnectConfig. */
export function getHostConnectionInfo(hostId: number): HostConnectionInfo {
  const host = getDb().prepare(`SELECT * FROM hosts WHERE id = ?`).get(hostId) as HostRow | undefined;
  if (!host) throw new Error("Machine introuvable.");
  const address = resolveHostAddress(host);
  if (!address) throw new Error("Aucune adresse IP renseignée pour cette machine.");
  return { address, port: host.ssh_port || 22, user: host.ssh_user || "root" };
}

/** Builds an ssh2 ConnectConfig for a host, using its most recent SSH credential from the vault.
 * `addressOverride` lets connectSsh below try each of a host's configured addresses in turn while
 * reusing the exact same credential-resolution logic — callers that just want "the" address as
 * before (resolveHostAddress's own preference order) can leave it out. */
export function buildSshConfig(hostId: number, addressOverride?: string): ConnectConfig {
  const db = getDb();
  const host = db.prepare(`SELECT * FROM hosts WHERE id = ?`).get(hostId) as HostRow | undefined;
  if (!host) throw new Error("Machine introuvable.");

  const address = addressOverride ?? resolveHostAddress(host);
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
    // ssh2 sends no keepalive traffic at all by default — an idle terminal (the user reading
    // output without typing) generates no packets, so a NAT gateway, firewall conntrack table, or
    // the remote sshd's own ClientAliveInterval can silently drop the TCP connection out from
    // under a session that's still very much in use. A keepalive every 15s (giving up after 4
    // unanswered, ~60s) keeps the connection alive through anything with a longer idle timeout
    // than that, while still detecting a genuinely dead connection reasonably quickly.
    keepaliveInterval: 15_000,
    keepaliveCountMax: 4,
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
  if (!host.needs_sudo || host.ssh_user === "root") return null;
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
  // A host whose configured login user is already root needs no elevation, whatever `needs_sudo`
  // says (it defaults to 1 for every new host — see db.ts — so this is easy to leave on by
  // mistake for a root-login machine). Wrapping in `sudo -S ... bash -lc` anyway is not just
  // redundant: it changes the shell environment (login shell, sudo's own stdin/env handling) in
  // ways that broke a real backup transfer — the outer `rsync -a ... -e ssh ...` command ran fine
  // executed directly, but failed with a bare "connection unexpectedly closed" once wrapped this
  // way, even though the exact same command worked when typed by hand in a plain root shell.
  if (!host.needs_sudo || host.ssh_user === "root") return { command: rawCommand, stdinPassword: null };

  const password = resolveSudoPassword(hostId);
  if (!password) {
    throw new Error(
      "Cette machine nécessite sudo mais aucun mot de passe n'est enregistré. Ajoute un identifiant SSH par mot de passe (ou un mot de passe sudo dédié)."
    );
  }
  return {
    // `bash -lc` (login shell) is deliberate — it picks up the full PATH from /etc/profile so
    // root-only tools (apt, docker, iptables...) resolve even when they're not on the
    // unprivileged user's PATH. The downside: some hosts' profile/rc chain unconditionally calls
    // `tput` for prompt coloring, which fails loudly ("tput: unknown terminal \"unknown\"") when
    // no terminal type is set, since this is a plain exec channel with no pty. `sudo` itself
    // resets the environment by default (env_reset), so TERM has to be set *after* sudo runs, via
    // `env`, not as a prefix before it — a `TERM=dumb sudo ...` prefix would just get stripped.
    command: `sudo -S -p '' env TERM=dumb bash -lc ${shellQuote(rawCommand)}`,
    stdinPassword: password,
  };
}

/** Matches ssh2's own wording for a handful of transient failures — a brand new connection
 * attempt refused or dropped before the handshake even completes, typically a NAS-grade sshd
 * (ZimaOS's very lightweight one in particular) momentarily out of free connection slots. Shared
 * by connectSsh's own address fallback below and by callers (lib/sftp.ts, lib/sshChannel.ts) that
 * layer their own retry-with-backoff on top of it for user-initiated actions. */
export function isTransientHandshakeError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /connection lost before handshake|econnreset|timed out while waiting for handshake/i.test(message);
}

function connectToAddress(hostId: number, address: string): Promise<SshClient> {
  const config = buildSshConfig(hostId, address);
  const conn = new SshClient();
  return new Promise<SshClient>((resolve, reject) => {
    conn.once("ready", () => resolve(conn));
    conn.once("error", reject);
    conn.connect(config);
  });
}

/**
 * Establishes a ready SSH connection to a host, falling back through every address configured for
 * it (Tailscale, then LAN, then public) instead of committing to just the one resolveHostAddress
 * happens to prefer. Before this, a host whose Tailscale link was down but still reachable on the
 * LAN (or vice versa) failed outright on every single feature that talks to it — Docker actions,
 * updates, backups, log streaming, the terminal, the file explorer — with "Timed out while waiting
 * for handshake", since nothing ever tried the other addresses on file for that host. This is the
 * one place that decision is made now; every caller below (and lib/sftp.ts, lib/sshChannel.ts,
 * lib/updates.ts, server/logs-ws.ts) goes through it instead of calling `new SshClient()` itself.
 */
export async function connectSsh(hostId: number): Promise<SshClient> {
  const host = getHostRow(hostId);
  const addresses = candidateAddresses(host);
  if (addresses.length === 0) throw new Error("Aucune adresse IP renseignée pour cette machine.");

  let lastErr: Error | null = null;
  for (const address of addresses) {
    try {
      return await connectToAddress(hostId, address);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr ?? new Error("Connexion SSH impossible.");
}

export type SshExecResult = { stdout: string; stderr: string; code: number };

/** Ends a connection and, if it hasn't torn down within a beat, forces the socket closed —
 * `.end()` alone can hang around waiting for a graceful SSH channel close that a stalled/hung
 * remote (e.g. a sudo prompt stuck behind a slow profile chain) may never send. */
function forceClose(conn: SshClient): void {
  try {
    conn.end();
  } catch {
    // already closing
  }
  setTimeout(() => {
    try {
      conn.destroy();
    } catch {
      // already destroyed
    }
  }, 500).unref();
}

/**
 * Runs a command over SSH and buffers its output. Pass `sudo: true` for commands that need
 * root (apt, docker) on a host configured with `needs_sudo` — the password is fed on stdin
 * automatically. Leave it false for read-only commands (stats, log tailing) that don't need it.
 *
 * `timeoutMs`, when set, actually tears down the connection when it fires — unlike wrapping the
 * returned promise in `withTimeout()` externally, which only stops *waiting* on the promise and
 * leaves the real SSH connection (and any sudo/exec channel stuck on the remote end) running.
 * That matters most for a host whose sudo/profile chain is genuinely slow (e.g. an appliance-style
 * NAS OS): every timed-out-but-still-open connection is one more concurrent session eating into
 * that sshd's connection limit, making the *next* attempt more likely to fail too.
 */
export function runSshCommand(
  hostId: number,
  rawCommand: string,
  opts: { sudo?: boolean; timeoutMs?: number } = {}
): Promise<SshExecResult> {
  // /demo sandbox: never open a real network connection — a public, unauthenticated demo is not
  // something to let point an SSH client at an arbitrary attacker-chosen address. See
  // lib/demo/fakeExec.ts for what gets simulated vs. a harmless empty success.
  if (isDemoContext()) {
    return Promise.resolve(fakeExec(hostId, rawCommand));
  }

  const { command, stdinPassword } = opts.sudo
    ? buildPrivilegedCommand(hostId, rawCommand)
    : { command: rawCommand, stdinPassword: null as string | null };

  return new Promise((resolve, reject) => {
    let settled = false;
    let conn: SshClient | null = null;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          if (conn) forceClose(conn);
          reject(new Error("Délai dépassé — la connexion SSH a été fermée."));
        }, opts.timeoutMs)
      : null;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };

    connectSsh(hostId)
      .then((readyConn) => {
        conn = readyConn;
        // The overall timeout above may have already fired while address fallback was still in
        // progress (trying a second/third address takes real time) — don't start exec'ing on a
        // connection nothing is waiting for anymore, just close it.
        if (settled) {
          forceClose(readyConn);
          return;
        }
        readyConn.exec(command, (err, stream) => {
          if (err) {
            readyConn.end();
            settle(() => reject(err));
            return;
          }
          if (stdinPassword) stream.write(`${stdinPassword}\n`);
          let stdout = "";
          let stderr = "";
          stream.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
          stream.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
          stream.on("close", (code: number) => {
            readyConn.end();
            settle(() => resolve({ stdout, stderr, code }));
          });
        });
      })
      .catch((err) => settle(() => reject(err)));
  });
}

/**
 * Like runSshCommand, but streams output chunk by chunk instead of buffering the whole thing —
 * for long-running commands (rsync transfers, vzdump, database dumps) where the caller wants to
 * append to a persisted job log incrementally rather than wait for the process to exit.
 */
export function runSshCommandStreaming(
  hostId: number,
  rawCommand: string,
  onChunk: (chunk: string) => void,
  opts: { sudo?: boolean; timeoutMs?: number } = {}
): Promise<number> {
  if (isDemoContext()) {
    const result = fakeExec(hostId, rawCommand);
    if (result.stdout) onChunk(result.stdout);
    if (result.stderr) onChunk(result.stderr);
    return Promise.resolve(result.code);
  }

  const { command, stdinPassword } = opts.sudo
    ? buildPrivilegedCommand(hostId, rawCommand)
    : { command: rawCommand, stdinPassword: null as string | null };

  return new Promise((resolve, reject) => {
    let settled = false;
    let conn: SshClient | null = null;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          if (conn) forceClose(conn);
          reject(new Error("Délai dépassé — la connexion SSH a été fermée."));
        }, opts.timeoutMs)
      : null;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };

    connectSsh(hostId)
      .then((readyConn) => {
        conn = readyConn;
        if (settled) {
          forceClose(readyConn);
          return;
        }
        readyConn.exec(command, (err, stream) => {
          if (err) {
            readyConn.end();
            settle(() => reject(err));
            return;
          }
          if (stdinPassword) stream.write(`${stdinPassword}\n`);
          stream.on("data", (d: Buffer) => onChunk(d.toString("utf8")));
          stream.stderr.on("data", (d: Buffer) => onChunk(d.toString("utf8")));
          stream.on("close", (code: number) => {
            readyConn.end();
            settle(() => resolve(code));
          });
        });
      })
      .catch((err) => settle(() => reject(err)));
  });
}
