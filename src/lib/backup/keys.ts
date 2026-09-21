import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { getDb } from "../db";
import { vaultEncrypt, vaultDecrypt } from "../crypto";
import { runSshCommand, shellQuote, getHostConnectionInfo } from "../ssh";

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

/** Only the algorithm + key material fields matter for an equality check — a trailing comment
 * (`ssh-keygen -y`'s output carries whatever `-C` comment the private key itself embeds, which may
 * differ cosmetically from what's stored) shouldn't cause a false mismatch. */
function keyFingerprint(publicKeyLine: string): string {
  return publicKeyLine.trim().split(/\s+/).slice(0, 2).join(" ");
}

/** Derives the public key back out of a private key blob (locally, never over the network) and
 * checks it against what's supposed to be its pair — the one local, cheap way to tell a genuinely
 * usable keypair from one that got corrupted at rest (a botched write, a vault re-encryption gone
 * wrong...) before ever deploying it to a real host. */
async function verifyKeypair(privateKey: string, publicKey: string): Promise<boolean> {
  const dir = mkdtempSync(path.join(tmpdir(), "homelab-backup-key-verify-"));
  const keyPath = path.join(dir, "id_ed25519");
  try {
    writeFileSync(keyPath, privateKey, { mode: 0o600 });
    const { stdout } = await execFileAsync("ssh-keygen", ["-y", "-f", keyPath]);
    return keyFingerprint(stdout) === keyFingerprint(publicKey);
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function generateAndStoreKeypair(): Promise<{ publicKey: string; privateKey: string }> {
  const dir = mkdtempSync(path.join(tmpdir(), "homelab-backup-key-"));
  const keyPath = path.join(dir, "id_ed25519");
  try {
    await execFileAsync("ssh-keygen", ["-t", "ed25519", "-f", keyPath, "-N", "", "-C", "homelab-panel-backup"]);
    const privateKey = readFileSync(keyPath, "utf8");
    const publicKey = readFileSync(`${keyPath}.pub`, "utf8").trim();
    getDb()
      .prepare(
        `INSERT INTO backup_ssh_key (id, public_key, private_key_encrypted) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET public_key = excluded.public_key, private_key_encrypted = excluded.private_key_encrypted`
      )
      .run(publicKey, vaultEncrypt(privateKey));
    return { publicKey, privateKey };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A single ed25519 keypair dedicated to backup transfers, generated once and reused for every
 * plan — separate from any login credential already on file for these hosts, so it can be
 * deployed narrowly (private key only on machines that run a backup, public key only on
 * machines that receive one) without touching the user's own SSH access.
 *
 * Self-healing: a stored keypair that no longer verifies against itself (see verifyKeypair) would
 * otherwise be silently redeployed everywhere forever, failing "Permission denied" on every single
 * host it touches with no way to fix it short of a developer clearing the database row by hand —
 * regenerating here instead means one bad keypair costs a single failed backup, not a permanently
 * broken feature.
 */
export async function getOrCreateBackupKeypair(): Promise<{ publicKey: string; privateKey: string }> {
  const existing = getStoredKeypair();
  if (existing && (await verifyKeypair(existing.privateKey, existing.publicKey))) return existing;
  return generateAndStoreKeypair();
}

/**
 * Both operations below only ever write inside the SSH login user's *own* home directory —
 * something that user can always do without any elevated privilege, so neither call passes
 * `sudo: true`, regardless of whether the host is otherwise configured to need it for privileged
 * commands (docker, apt...). This isn't just least-privilege tidiness: running as root via
 * `sudo -S ... bash -lc` forces a *login* shell, and bash's own login-shell startup unconditionally
 * tries to chdir into $HOME and prints "Could not chdir to home directory ... No such file or
 * directory" when that fails — which happens on NAS OSes (Synology in particular) whose "User
 * Home" service isn't enabled for a given account, or whose home volume isn't the one currently
 * mounted. That warning, plus root's own profile/PATH chain, only ever muddies what's actually a
 * much simpler operation. Running as the real login user directly avoids the login-shell chdir
 * entirely and resolves `~`/$HOME the same way that user's own normal SSH session would.
 *
 * `~<user>` (rather than a bare `~`) still does an explicit passwd lookup for that user, assigned
 * to a variable so it can be used inside a double-quoted string afterwards (tilde expansion only
 * happens in an unquoted or assignment position) — harmless here since the process already runs
 * as that same user, but it keeps this resilient if sudo were ever reintroduced for some host.
 */
function homeVarAssignment(hostId: number): string {
  const { user } = getHostConnectionInfo(hostId);
  return `BACKUP_HOME=~${user}`;
}

/** A NAS-side "the account's home directory doesn't actually exist" failure (Synology's "User
 * Home" service disabled for that account is the classic case) surfaces as a raw, cryptic
 * mkdir/bash error — spelled out here once so it points at the actual fix instead of looking like
 * a panel bug. */
function explainHomeDirError(stderr: string): string {
  if (/chdir to home directory|No such file or directory/i.test(stderr)) {
    return (
      `${stderr}\n\nLe dossier personnel du compte SSH de cette machine semble ne pas exister réellement sur le ` +
      `disque (courant sur un NAS Synology quand le service "Dossier personnel de l'utilisateur" n'est pas activé ` +
      `pour ce compte). La clé de sauvegarde doit être placée dans le vrai dossier personnel de ce compte pour que ` +
      `SSH l'accepte — active ce service (ou choisis un compte qui a déjà un dossier personnel) côté machine.`
    );
  }
  return stderr;
}

/**
 * Writes the backup private key onto a host that needs to push data out (via rsync -e ssh),
 * and returns its *absolute* path. rsync's `-e` command is split and exec'd directly rather
 * than run through a shell, so a `~`-based path would never get tilde-expanded there — the
 * caller needs a real path to embed in that argument.
 */
export async function ensurePrivateKeyDeployed(hostId: number): Promise<string> {
  const { privateKey, publicKey } = await getOrCreateBackupKeypair();
  const command = [
    homeVarAssignment(hostId),
    `mkdir -p "$BACKUP_HOME/.ssh" && chmod 700 "$BACKUP_HOME/.ssh"`,
    `cat > "$BACKUP_HOME/.ssh/homelab_panel_backup_key" <<'HOMELAB_BACKUP_KEY_EOF'\n${privateKey}\nHOMELAB_BACKUP_KEY_EOF`,
    `chmod 600 "$BACKUP_HOME/.ssh/homelab_panel_backup_key"`,
    // Derives the public key straight back out of the file that was just written, on this same
    // host — the one way to prove the deployed key is actually intact and usable rather than
    // corrupted by some quoting/encoding edge case, before any later "Permission denied" during
    // the real rsync leaves that as just one hypothesis among several. ssh-keygen ships with every
    // OpenSSH install (client or server), so its absence would itself be unusual enough to surface
    // rather than silently ignore.
    `echo "___PUBFP___$(ssh-keygen -y -f "$BACKUP_HOME/.ssh/homelab_panel_backup_key" 2>&1)"`,
    `echo "___KEYPATH___$BACKUP_HOME/.ssh/homelab_panel_backup_key"`,
  ].join("\n");
  const { code, stdout, stderr } = await runSshCommand(hostId, command);
  if (code !== 0) throw new Error(explainHomeDirError(stderr) || "Impossible d'installer la clé de sauvegarde sur cette machine.");

  const pubMatch = stdout.match(/___PUBFP___(.*)/);
  const derivedPublicKey = pubMatch?.[1].trim() ?? "";
  // Only a line that actually looks like a public key is treated as a verification result — an
  // error (ssh-keygen missing from PATH, an unreadable file for some unrelated reason) shouldn't
  // be misread as "the key is corrupted" when it really just means verification couldn't run.
  if (/^(ssh-|ecdsa-|sk-)\S+ /.test(derivedPublicKey) && keyFingerprint(derivedPublicKey) !== keyFingerprint(publicKey)) {
    throw new Error(
      `La clé privée déployée sur cette machine ne correspond pas à la clé publique attendue une fois relue depuis ` +
        `le disque (${derivedPublicKey}) — écriture corrompue plutôt qu'un problème d'autorisation. Relance la ` +
        `sauvegarde ; si ça persiste sur toutes les machines, la paire de clés elle-même est peut-être à régénérer.`
    );
  }

  const match = stdout.match(/___KEYPATH___(\S+)/);
  if (!match) throw new Error("Impossible de déterminer le chemin de la clé de sauvegarde sur cette machine.");
  return match[1];
}

/**
 * Authorizes the backup public key on a host that needs to receive data — self-healing rather
 * than a plain "skip if a marker-tagged line is already there" idempotency check: several bugs in
 * this exact function got fixed across earlier sessions (wrong home directory under sudo, needing
 * sudo at all...), any of which could have already left a stale or malformed marker-tagged line
 * behind from a past failed run. A dumb `grep marker || append` would see that old line, consider
 * the key "already authorized", and never fix it — so this always drops any existing
 * marker-tagged line first, then appends a fresh one matching the keypair actually on file today.
 */
export async function ensurePublicKeyAuthorized(hostId: number): Promise<void> {
  const { publicKey } = await getOrCreateBackupKeypair();
  const line = `${publicKey.trim()} ${AUTHORIZED_KEYS_MARKER}`;
  const command = [
    homeVarAssignment(hostId),
    `mkdir -p "$BACKUP_HOME/.ssh" && chmod 700 "$BACKUP_HOME/.ssh"`,
    `touch "$BACKUP_HOME/.ssh/authorized_keys" && chmod 600 "$BACKUP_HOME/.ssh/authorized_keys"`,
    `{ grep -vF ${shellQuote(AUTHORIZED_KEYS_MARKER)} "$BACKUP_HOME/.ssh/authorized_keys" || true; } > "$BACKUP_HOME/.ssh/authorized_keys.tmp"`,
    `mv "$BACKUP_HOME/.ssh/authorized_keys.tmp" "$BACKUP_HOME/.ssh/authorized_keys"`,
    `echo ${shellQuote(line)} >> "$BACKUP_HOME/.ssh/authorized_keys"`,
  ].join(" && ");
  const { code, stderr } = await runSshCommand(hostId, command);
  if (code !== 0) throw new Error(explainHomeDirError(stderr) || "Impossible d'autoriser la clé de sauvegarde sur cette machine.");
}
