import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { getDb } from "../db";
import { vaultEncrypt, vaultDecrypt } from "../crypto";
import { runSshCommand, shellQuote } from "../ssh";

const execFileAsync = promisify(execFile);

const AUTHORIZED_KEYS_MARKER = "homelab-panel-backup";

type KeyRow = { public_key: string; private_key_encrypted: string };

function getStoredKeypair(): { publicKey: string; privateKey: string } | null {
  const row = getDb().prepare(`SELECT public_key, private_key_encrypted FROM backup_ssh_key WHERE id = 1`).get() as
    | KeyRow
    | undefined;
  if (!row) return null;
  return { publicKey: row.public_key, privateKey: vaultDecrypt(row.private_key_encrypted) };
}

/**
 * A single ed25519 keypair dedicated to backup transfers, generated once and reused for every
 * plan — separate from any login credential already on file for these hosts, so it can be
 * deployed narrowly (private key only on machines that run a backup, public key only on
 * machines that receive one) without touching the user's own SSH access.
 */
export async function getOrCreateBackupKeypair(): Promise<{ publicKey: string; privateKey: string }> {
  const existing = getStoredKeypair();
  if (existing) return existing;

  const dir = mkdtempSync(path.join(tmpdir(), "homelab-backup-key-"));
  const keyPath = path.join(dir, "id_ed25519");
  try {
    await execFileAsync("ssh-keygen", ["-t", "ed25519", "-f", keyPath, "-N", "", "-C", "homelab-panel-backup"]);
    const privateKey = readFileSync(keyPath, "utf8");
    const publicKey = readFileSync(`${keyPath}.pub`, "utf8").trim();
    getDb()
      .prepare(`INSERT INTO backup_ssh_key (id, public_key, private_key_encrypted) VALUES (1, ?, ?)`)
      .run(publicKey, vaultEncrypt(privateKey));
    return { publicKey, privateKey };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Writes the backup private key onto a host that needs to push data out (via rsync -e ssh),
 * and returns its *absolute* path. rsync's `-e` command is split and exec'd directly rather
 * than run through a shell, so a `~`-based path would never get tilde-expanded there — the
 * caller needs a real path to embed in that argument.
 */
export async function ensurePrivateKeyDeployed(hostId: number): Promise<string> {
  const { privateKey } = await getOrCreateBackupKeypair();
  const command = [
    `mkdir -p ~/.ssh && chmod 700 ~/.ssh`,
    `cat > ~/.ssh/homelab_panel_backup_key <<'HOMELAB_BACKUP_KEY_EOF'\n${privateKey}\nHOMELAB_BACKUP_KEY_EOF`,
    `chmod 600 ~/.ssh/homelab_panel_backup_key`,
    `echo "___KEYPATH___$HOME/.ssh/homelab_panel_backup_key"`,
  ].join("\n");
  const { code, stdout, stderr } = await runSshCommand(hostId, command, { sudo: true });
  if (code !== 0) throw new Error(stderr || "Impossible d'installer la clé de sauvegarde sur cette machine.");
  const match = stdout.match(/___KEYPATH___(\S+)/);
  if (!match) throw new Error("Impossible de déterminer le chemin de la clé de sauvegarde sur cette machine.");
  return match[1];
}

/** Authorizes the backup public key on a host that needs to receive data — idempotent, only
 * appends the line once (marked with a comment so it's identifiable/removable later). */
export async function ensurePublicKeyAuthorized(hostId: number): Promise<void> {
  const { publicKey } = await getOrCreateBackupKeypair();
  const line = `${publicKey.trim()} ${AUTHORIZED_KEYS_MARKER}`;
  const command = [
    `mkdir -p ~/.ssh && chmod 700 ~/.ssh`,
    `touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`,
    `grep -qF ${shellQuote(AUTHORIZED_KEYS_MARKER)} ~/.ssh/authorized_keys || echo ${shellQuote(line)} >> ~/.ssh/authorized_keys`,
  ].join(" && ");
  const { code, stderr } = await runSshCommand(hostId, command, { sudo: true });
  if (code !== 0) throw new Error(stderr || "Impossible d'autoriser la clé de sauvegarde sur cette machine.");
}
