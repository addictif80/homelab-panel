import { runSshCommand, runSshCommandStreaming, getHostConnectionInfo, shellQuote } from "../ssh";
import { ensurePrivateKeyDeployed, ensurePublicKeyAuthorized } from "./keys";

// These are quick filesystem metadata ops (mkdir/find/rm), never expected to take long — unlike
// the actual rsync transfer below, which legitimately can. Without a timeout, a stuck sudo/profile
// chain on the target (an appliance-style NAS being the common case) hangs a backup run
// indefinitely instead of surfacing a clean error.
const METADATA_TIMEOUT_MS = 15_000;

export async function ensureRemoteDir(hostId: number, dirPath: string): Promise<void> {
  const { code, stderr } = await runSshCommand(hostId, `mkdir -p ${shellQuote(dirPath)}`, {
    sudo: true,
    timeoutMs: METADATA_TIMEOUT_MS,
  });
  if (code !== 0) throw new Error(stderr || `Impossible de créer le dossier ${dirPath} sur la destination.`);
}

/**
 * rsync needs its own binary on *both* ends — the local one spawns a remote `rsync --server ...`
 * over the ssh transport, and a destination missing it (common on a minimal/appliance NAS image
 * like ZimaOS, which doesn't necessarily ship rsync by default) makes that remote command fail
 * immediately, closing the connection before a single protocol byte is sent. rsync's own error
 * for that ("connection unexpectedly closed (0 bytes received so far)") reads exactly like a
 * network/auth problem even once the SSH connection and its key are both actually fine — checked
 * here, over the panel's own already-proven-working credential, so a missing binary gets a plain
 * instruction instead of that cryptic protocol error.
 */
export async function ensureRsyncAvailable(hostId: number): Promise<void> {
  const { code } = await runSshCommand(hostId, `command -v rsync`, { timeoutMs: METADATA_TIMEOUT_MS });
  if (code !== 0) {
    throw new Error(
      "rsync n'est pas installé (ou introuvable dans le PATH) sur cette machine — c'est nécessaire des deux côtés " +
        "d'un transfert de sauvegarde. Installe-le (paquet \"rsync\", ou l'application correspondante si c'est un " +
        "NAS comme ZimaOS ou Synology) avant de relancer."
    );
  }
}

/** Lists the immediate subdirectories of `dirPath` (one level), or [] if it doesn't exist yet. */
export async function listRemoteDirs(hostId: number, dirPath: string): Promise<string[]> {
  const { stdout, code } = await runSshCommand(
    hostId,
    `find ${shellQuote(dirPath)} -mindepth 1 -maxdepth 1 -type d -printf '%f\\n' 2>/dev/null`,
    { sudo: true, timeoutMs: METADATA_TIMEOUT_MS }
  );
  if (code !== 0) return [];
  return stdout.split("\n").filter(Boolean).sort();
}

export async function removeRemotePath(hostId: number, targetPath: string): Promise<void> {
  await runSshCommand(hostId, `rm -rf ${shellQuote(targetPath)}`, { sudo: true, timeoutMs: METADATA_TIMEOUT_MS });
}

/**
 * Pushes `sourcePath` (file or directory, on `fromHostId`) directly into `destDir` (on
 * `toHostId`), rsync running on the source host talking straight to the destination host over
 * SSH — the panel itself is never in the data path. `linkDestDir`, when given (the matching
 * directory from a previous snapshot), makes rsync hardlink unchanged files instead of
 * recopying them, so a versioned chain of snapshots doesn't cost full disk space each time.
 */
export async function rsyncTransfer(opts: {
  fromHostId: number;
  toHostId: number;
  sourcePath: string;
  destDir: string;
  linkDestDir?: string | null;
  append: (text: string) => void;
}): Promise<void> {
  const { fromHostId, toHostId, sourcePath, destDir, linkDestDir, append } = opts;

  const keyPath = await ensurePrivateKeyDeployed(fromHostId);
  await ensurePublicKeyAuthorized(toHostId);
  await ensureRemoteDir(toHostId, destDir);
  await Promise.all([ensureRsyncAvailable(fromHostId), ensureRsyncAvailable(toHostId)]);

  const dest = getHostConnectionInfo(toHostId);
  const destDirSlash = destDir.endsWith("/") ? destDir : `${destDir}/`;
  // IdentitiesOnly=yes is the load-bearing flag here, not cosmetic: without it, OpenSSH tries the
  // account's own default identity files (~/.ssh/id_rsa, id_ed25519...) and any key an ssh-agent
  // happens to offer *before or alongside* the one explicitly given via -i, even though -i is
  // set — each rejected attempt prints "Permission denied, please try again.", and enough of them
  // trip the destination sshd's MaxAuthTries and drop the connection before our actual (valid) key
  // is ever tried. That reproduces identically on any destination, since it depends only on what
  // other keys exist on the *source* side, which is exactly the "fails no matter which server"
  // symptom this was chasing across several destination-side fixes that (rightly) didn't touch it.
  const sshOpts = `ssh -i ${keyPath} -o IdentitiesOnly=yes -p ${dest.port} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
  const linkFlag = linkDestDir
    ? `--link-dest=${shellQuote(linkDestDir.endsWith("/") ? linkDestDir : `${linkDestDir}/`)} `
    : "";

  const command = `rsync -a --delete --stats ${linkFlag}-e ${shellQuote(sshOpts)} ${shellQuote(sourcePath)} ${shellQuote(`${dest.user}@${dest.address}:${destDirSlash}`)}`;

  append(`\n$ copie de ${sourcePath} vers ${dest.user}@${dest.address}:${destDirSlash}\n`);
  const code = await runSshCommandStreaming(fromHostId, command, append, { sudo: true });
  if (code !== 0) throw new Error(`Échec du transfert (code ${code}) pour ${sourcePath}.`);
}
