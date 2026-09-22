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
 * rsync needs its own binary reachable on *both* ends of the exact connection that will actually
 * be used — the local one spawns a remote `rsync --server ...` over the ssh transport, and if
 * that fails to even start, the connection closes before a single protocol byte is sent, which
 * rsync reports as "connection unexpectedly closed (0 bytes received so far)": indistinguishable,
 * from the log alone, from a network or auth problem even once those are both actually fine.
 *
 * This has to go through the *same* nested path the real transfer uses — from the source host,
 * over the dedicated backup key, to the destination — not a separate check via the panel's own
 * regular credential for that host. Those can genuinely land in different environments on the
 * same machine (a `Match`/forced-command block keyed on the authenticating key, a restricted
 * shell for keys added outside the vendor's own UI, a container-namespaced sshd...), so a check
 * that passes over one credential doesn't prove anything about a transfer made over the other.
 */
export async function ensureRsyncReachable(fromHostId: number, toHostId: number, keyPath: string): Promise<void> {
  const dest = getHostConnectionInfo(toHostId);
  const sshOpts = `-i ${keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -p ${dest.port}`;
  const command = `ssh ${sshOpts} ${dest.user}@${dest.address} "command -v rsync"`;
  const { code, stdout, stderr } = await runSshCommand(fromHostId, command, { sudo: true, timeoutMs: METADATA_TIMEOUT_MS });
  if (code !== 0 || !stdout.trim()) {
    throw new Error(
      `rsync n'est pas accessible sur la destination via la connexion réellement utilisée pour le transfert ` +
        `(clé de sauvegarde dédiée) — ${stderr.trim() || "aucune sortie renvoyée"}. Installe rsync sur cette ` +
        `machine si ce n'est pas déjà fait ; si c'est déjà le cas, le compte SSH utilisé pour les sauvegardes n'y ` +
        `a peut-être pas accès (PATH restreint, commande forcée sur cette clé...).`
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
  await ensureRsyncReachable(fromHostId, toHostId, keyPath);

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
