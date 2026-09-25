import { runSshCommand, shellQuote, isTransientHandshakeError } from "./ssh";
import { isDemoContext } from "./demo/context";

export type FileEntry = {
  name: string;
  type: "file" | "directory" | "symlink" | "other";
  size: number;
  modifiedAt: number;
};

/**
 * The file explorer used to browse over SFTP as the plain SSH login user, with no way to sudo
 * (SFTP has no such concept — it's a binary protocol tied to whatever the sftp-server subsystem
 * process's own uid can already do, not a shell command sudo can wrap). That meant a path the
 * login account couldn't read/write stayed unreachable here even when every other part of the
 * panel could touch it fine via `runSshCommand(..., { sudo: true })`.
 *
 * This module now drives the same operations as plain shell commands over that same sudo-capable
 * exec channel instead — `stat`, `base64`, `mkdir`, `rm`/`rmdir` — kept deliberately to flags both
 * GNU coreutils and BusyBox (common on NAS/router firmware) support, since this panel's whole
 * point is running across a heterogeneous fleet, not just Debian/Ubuntu boxes. Binary-safe transfer
 * (arbitrary file content, not just text) goes through base64 both ways — the same technique this
 * codebase already uses for DB dumps/restores over the same kind of channel — since the exec
 * channel's output is otherwise decoded as a UTF-8 string and would corrupt raw binary bytes.
 */
function modeToType(mode: number): FileEntry["type"] {
  if ((mode & 0o170000) === 0o040000) return "directory";
  if ((mode & 0o170000) === 0o120000) return "symlink";
  if ((mode & 0o170000) === 0o100000) return "file";
  return "other";
}

/** A raw path a shell command's own exit code can't easily tell apart from "exists but some other
 * failure" — spelled out once, centrally, the same way explainSftpError used to for the old SFTP
 * "Permission denied" case (now much rarer since these run with sudo, but a genuinely nonexistent
 * path, or a path sudo itself can't reach — an NFS mount with root squashed, say — still happens). */
function explainFileCommandError(stderr: string, path: string): Error {
  if (/permission denied/i.test(stderr)) {
    return new Error(
      `Permission refusée sur "${path}" même avec les privilèges élevés du panel — un montage réseau avec ` +
        `"root squash" (NFS, notamment) refuse root explicitement quel que soit le compte. Vérifie les droits ` +
        `réels sur ce point de montage côté machine.`
    );
  }
  return new Error(stderr.trim() || `Impossible d'accéder à "${path}" sur cette machine.`);
}

/** Same ZimaOS-style retry the old SFTP path used: a NAS-grade sshd can be momentarily out of free
 * connection slots right when a file-explorer click lands, surfacing as "Connection lost before
 * handshake" — backs off through several attempts rather than failing a normal click after one. */
async function runFileCommand(hostId: number, script: string): Promise<{ stdout: string; stderr: string; code: number }> {
  if (isDemoContext()) {
    throw new Error("Explorateur de fichiers non disponible en mode démo.");
  }

  const retryDelaysMs = [800, 2000, 4000, 6000];
  async function attempt(remaining: number[]): Promise<{ stdout: string; stderr: string; code: number }> {
    try {
      return await runSshCommand(hostId, script, { sudo: true, timeoutMs: 30_000 });
    } catch (err) {
      if (remaining.length > 0 && isTransientHandshakeError(err)) {
        const [delay, ...rest] = remaining;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return attempt(rest);
      }
      throw err;
    }
  }
  return attempt(retryDelaysMs);
}

export async function listDirectory(hostId: number, path: string): Promise<FileEntry[]> {
  const script = [
    `cd ${shellQuote(path)} || exit 3`,
    `for f in .* *; do`,
    `  [ "$f" = "." ] && continue`,
    `  [ "$f" = ".." ] && continue`,
    `  [ -e "$f" ] || [ -L "$f" ] || continue`,
    // %f (raw mode in hex) is the one stat field GNU coreutils and BusyBox both implement
    // identically — unlike %F ("regular file"/"directory"/...), whose exact wording/availability
    // varies, %f is a direct printf of st_mode that modeToType() above already knows how to read.
    `  stat -c '%n\t%s\t%Y\t%f' -- "$f" 2>/dev/null`,
    `done`,
  ].join("\n");

  const { stdout, code, stderr } = await runFileCommand(hostId, script);
  if (code === 3) throw new Error(`Dossier introuvable ou inaccessible : ${path}`);
  if (code !== 0) throw explainFileCommandError(stderr, path);

  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, size, mtime, modeHex] = line.split("\t");
      return {
        name,
        type: modeToType(parseInt(modeHex, 16) || 0),
        size: parseInt(size, 10) || 0,
        modifiedAt: (parseInt(mtime, 10) || 0) * 1000,
      };
    });
}

const DEFAULT_MAX_BYTES = 1_000_000;

export async function readFile(hostId: number, path: string, maxBytes = DEFAULT_MAX_BYTES): Promise<Buffer> {
  const sizeScript = `[ -e ${shellQuote(path)} ] || exit 3; stat -c%s -- ${shellQuote(path)} 2>&1`;
  const sizeResult = await runFileCommand(hostId, sizeScript);
  if (sizeResult.code === 3) throw new Error(`Fichier introuvable : ${path}`);
  if (sizeResult.code !== 0) throw explainFileCommandError(sizeResult.stderr, path);
  const size = parseInt(sizeResult.stdout.trim(), 10);
  if (Number.isFinite(size) && size > maxBytes) {
    throw new Error("Fichier trop volumineux pour un aperçu.");
  }

  // `| tr -d '\n'` normalizes away line-wrapping differences between base64 implementations
  // (GNU coreutils wraps at 76 chars by default, some BusyBox builds don't support -w0 to disable
  // it) rather than depending on a flag that isn't universally supported.
  const dataScript = `base64 -- ${shellQuote(path)} 2>&1 | tr -d '\\n'`;
  const { stdout, code, stderr } = await runFileCommand(hostId, dataScript);
  if (code !== 0) throw explainFileCommandError(stderr, path);
  return Buffer.from(stdout.trim(), "base64");
}

export async function writeFile(hostId: number, path: string, content: Buffer): Promise<void> {
  const b64 = content.toString("base64");
  // Base64 payload travels as a heredoc (pure ASCII, so it survives the exec channel's UTF-8
  // string handling intact) rather than as raw bytes — the same "no separate transfer step"
  // technique lib/dbManager/dumpRestore.ts uses for restoring a database dump over the same kind
  // of channel.
  const script = `base64 -d > ${shellQuote(path)} <<'HLP_FILE_EOF'\n${b64}\nHLP_FILE_EOF`;
  const { code, stderr } = await runFileCommand(hostId, script);
  if (code !== 0) throw explainFileCommandError(stderr, path);
}

export async function deleteEntry(hostId: number, path: string, isDirectory: boolean): Promise<void> {
  // rmdir (not `rm -rf`) for a directory — matches the old SFTP behavior (sftp.rmdir only ever
  // removed an already-empty directory) rather than silently turning "delete" into a recursive one.
  const script = isDirectory ? `rmdir -- ${shellQuote(path)}` : `rm -f -- ${shellQuote(path)}`;
  const { code, stderr } = await runFileCommand(hostId, script);
  if (code !== 0) throw explainFileCommandError(stderr, path);
}

export async function makeDirectory(hostId: number, path: string): Promise<void> {
  // Plain mkdir (not -p) — matches the old sftp.mkdir behavior of failing when the parent doesn't
  // exist yet, rather than silently creating a whole new nested path.
  const { code, stderr } = await runFileCommand(hostId, `mkdir -- ${shellQuote(path)}`);
  if (code !== 0) throw explainFileCommandError(stderr, path);
}

// --- Cross-host copy support (lib/fileCopy.ts) ---
// The panel has no credential that lets the source host log into the destination directly, so a
// copy between two different machines relays the data itself: read a file as base64 from the
// source, write it as base64 to the destination, one file at a time — each call its own
// independent sudo-capable command rather than a persistent session (there's no equivalent of an
// open SFTP handle to reuse once these are plain one-shot shell commands, and a homelab-scale
// file copy has no real need for one).

export async function statPath(hostId: number, path: string): Promise<{ isDirectory: boolean; size: number }> {
  const { stdout, code, stderr } = await runFileCommand(hostId, `stat -c '%s\t%f' -- ${shellQuote(path)} 2>&1`);
  if (code !== 0) throw explainFileCommandError(stderr, path);
  const [size, modeHex] = stdout.trim().split("\t");
  return { isDirectory: modeToType(parseInt(modeHex, 16) || 0) === "directory", size: parseInt(size, 10) || 0 };
}

export async function readdirEntries(hostId: number, path: string): Promise<FileEntry[]> {
  return listDirectory(hostId, path);
}

/** Best-effort: a directory that already exists (or can't be created for another reason) is not
 * treated as fatal — the copy just continues into it, matching the old SFTP behavior. */
export async function mkdirIfMissing(hostId: number, path: string): Promise<void> {
  await runFileCommand(hostId, `mkdir -- ${shellQuote(path)} 2>/dev/null; true`).catch(() => {});
}

/** Relays one file from `sourceHostId` to `destHostId` via this process — reads it whole as
 * base64 from the source, then writes it whole to the destination, rather than streaming
 * chunk-by-chunk the way the old SFTP-to-SFTP pipe did. Fine for a homelab-scale file explorer
 * copy; a genuinely huge transfer between two managed hosts is better served by a real backup
 * plan (rsync-based, see lib/backup/) than this one-off "copy this file over" action. */
export async function streamCopy(sourceHostId: number, sourcePath: string, destHostId: number, destPath: string): Promise<void> {
  const content = await readFile(sourceHostId, sourcePath, Number.MAX_SAFE_INTEGER);
  await writeFile(destHostId, destPath, content);
}
