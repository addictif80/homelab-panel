import { runSshCommand, runSshCommandStreaming, getHostConnectionInfo, shellQuote } from "../ssh";
import { ensurePrivateKeyDeployed, ensurePublicKeyAuthorized } from "./keys";

export async function ensureRemoteDir(hostId: number, dirPath: string): Promise<void> {
  const { code, stderr } = await runSshCommand(hostId, `mkdir -p ${shellQuote(dirPath)}`, { sudo: true });
  if (code !== 0) throw new Error(stderr || `Impossible de créer le dossier ${dirPath} sur la destination.`);
}

/** Lists the immediate subdirectories of `dirPath` (one level), or [] if it doesn't exist yet. */
export async function listRemoteDirs(hostId: number, dirPath: string): Promise<string[]> {
  const { stdout, code } = await runSshCommand(
    hostId,
    `find ${shellQuote(dirPath)} -mindepth 1 -maxdepth 1 -type d -printf '%f\\n' 2>/dev/null`,
    { sudo: true }
  );
  if (code !== 0) return [];
  return stdout.split("\n").filter(Boolean).sort();
}

export async function removeRemotePath(hostId: number, targetPath: string): Promise<void> {
  await runSshCommand(hostId, `rm -rf ${shellQuote(targetPath)}`, { sudo: true });
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

  const dest = getHostConnectionInfo(toHostId);
  const destDirSlash = destDir.endsWith("/") ? destDir : `${destDir}/`;
  const sshOpts = `ssh -i ${keyPath} -p ${dest.port} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
  const linkFlag = linkDestDir
    ? `--link-dest=${shellQuote(linkDestDir.endsWith("/") ? linkDestDir : `${linkDestDir}/`)} `
    : "";

  const command = `rsync -a --delete --stats ${linkFlag}-e ${shellQuote(sshOpts)} ${shellQuote(sourcePath)} ${shellQuote(`${dest.user}@${dest.address}:${destDirSlash}`)}`;

  append(`\n$ copie de ${sourcePath} vers ${dest.user}@${dest.address}:${destDirSlash}\n`);
  const code = await runSshCommandStreaming(fromHostId, command, append, { sudo: true });
  if (code !== 0) throw new Error(`Échec du transfert (code ${code}) pour ${sourcePath}.`);
}
