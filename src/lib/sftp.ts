import { Client as SshClient, type SFTPWrapper } from "ssh2";
import { buildSshConfig } from "./ssh";
import { isDemoContext } from "./demo/context";

export type FileEntry = {
  name: string;
  type: "file" | "directory" | "symlink" | "other";
  size: number;
  modifiedAt: number;
};

function connectOnce<T>(hostId: number, fn: (sftp: SFTPWrapper, conn: SshClient) => Promise<T>): Promise<T> {
  const config = buildSshConfig(hostId);
  const conn = new SshClient();

  return new Promise<T>((resolve, reject) => {
    conn.on("ready", () => {
      conn.sftp((err, sftp) => {
        if (err) {
          conn.end();
          reject(err);
          return;
        }
        fn(sftp, conn)
          .then((result) => {
            conn.end();
            resolve(result);
          })
          .catch((e) => {
            conn.end();
            reject(e);
          });
      });
    });
    conn.on("error", reject);
    conn.connect(config);
  });
}

function isTransientHandshakeError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /connection lost before handshake|econnreset|timed out while waiting for handshake/i.test(message);
}

/** SFTP browses as the plain SSH login user with no sudo elevation (SFTP has no such concept) —
 * unlike the shell commands the rest of the panel runs, which can be configured to sudo. A raw
 * "Permission denied" from the SFTP layer is easy to misread as a bug, so it's spelled out here
 * once, centrally, instead of leaving every caller to guess why a folder that shell commands can
 * reach still can't be browsed or picked as a backup destination. */
function explainSftpError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (/permission denied/i.test(message)) {
    return new Error(
      "Permission refusée sur ce chemin — l'explorateur de fichiers et le sélecteur de dossier naviguent avec le compte SSH de cette machine, sans les privilèges élevés (sudo) que le panel peut utiliser ailleurs. Donne à ce compte les droits de lecture (et d'écriture, pour une destination de sauvegarde) sur ce dossier côté machine, ou choisis un compte qui les a déjà."
    );
  }
  return err instanceof Error ? err : new Error(message);
}

/** A picker/explorer click can land while a NAS-grade sshd is momentarily out of free connection
 * slots (or mid-rotation), surfacing as "Connection lost before handshake". A single 800ms retry
 * clears most of these, but some embedded NAS distros (ZimaOS in particular — a very lightweight
 * sshd with a strict, slow-to-clear cap on concurrent/per-minute connection attempts) need longer
 * than that to free up a slot, so this backs off through several attempts before giving up rather
 * than failing a normal folder click after one quick retry. */
function withSftp<T>(hostId: number, fn: (sftp: SFTPWrapper, conn: SshClient) => Promise<T>): Promise<T> {
  // /demo sandbox: no real network connection, and building a faithful fake SFTP filesystem isn't
  // worth it for a feature that isn't central to the walkthrough — degrade to a clear message
  // instead of crashing.
  if (isDemoContext()) {
    return Promise.reject(new Error("Explorateur de fichiers non disponible en mode démo."));
  }

  const retryDelaysMs = [800, 2000, 4000, 6000];

  async function attempt(remaining: number[]): Promise<T> {
    try {
      return await connectOnce(hostId, fn);
    } catch (err) {
      if (remaining.length > 0 && isTransientHandshakeError(err)) {
        const [delay, ...rest] = remaining;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return attempt(rest);
      }
      throw explainSftpError(err);
    }
  }

  return attempt(retryDelaysMs);
}

function modeToType(mode: number): FileEntry["type"] {
  if ((mode & 0o170000) === 0o040000) return "directory";
  if ((mode & 0o170000) === 0o120000) return "symlink";
  if ((mode & 0o170000) === 0o100000) return "file";
  return "other";
}

export function listDirectory(hostId: number, path: string): Promise<FileEntry[]> {
  return withSftp(hostId, (sftp) => {
    return new Promise((resolve, reject) => {
      sftp.readdir(path, (err, list) => {
        if (err) return reject(err);
        resolve(
          list.map((item) => ({
            name: item.filename,
            type: modeToType(item.attrs.mode),
            size: item.attrs.size,
            modifiedAt: item.attrs.mtime * 1000,
          }))
        );
      });
    });
  });
}

export function readFile(hostId: number, path: string, maxBytes = 1_000_000): Promise<Buffer> {
  return withSftp(hostId, (sftp) => {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      const stream = sftp.createReadStream(path);
      stream.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          stream.destroy();
          reject(new Error("Fichier trop volumineux pour un aperçu."));
          return;
        }
        chunks.push(chunk);
      });
      stream.on("error", reject);
      stream.on("end", () => resolve(Buffer.concat(chunks)));
    });
  });
}

export function writeFile(hostId: number, path: string, content: Buffer): Promise<void> {
  return withSftp(hostId, (sftp) => {
    return new Promise((resolve, reject) => {
      const stream = sftp.createWriteStream(path);
      stream.on("error", reject);
      stream.on("close", () => resolve());
      stream.end(content);
    });
  });
}

export function deleteEntry(hostId: number, path: string, isDirectory: boolean): Promise<void> {
  return withSftp(hostId, (sftp) => {
    return new Promise((resolve, reject) => {
      const cb = (err: Error | null | undefined) => (err ? reject(err) : resolve());
      if (isDirectory) sftp.rmdir(path, cb);
      else sftp.unlink(path, cb);
    });
  });
}

export function makeDirectory(hostId: number, path: string): Promise<void> {
  return withSftp(hostId, (sftp) => {
    return new Promise((resolve, reject) => {
      sftp.mkdir(path, (err) => (err ? reject(err) : resolve()));
    });
  });
}

// --- Lower-level helpers for copying between two hosts, where a connection needs to stay
// open across many operations instead of one-shot per call like withSftp() above. ---

/** Opens an SSH+SFTP session and hands back the raw handles — caller owns closing `conn`. */
export function openSftp(hostId: number): Promise<{ conn: SshClient; sftp: SFTPWrapper }> {
  const config = buildSshConfig(hostId);
  const conn = new SshClient();
  return new Promise((resolve, reject) => {
    conn.on("ready", () => {
      conn.sftp((err, sftp) => (err ? reject(err) : resolve({ conn, sftp })));
    });
    conn.on("error", reject);
    conn.connect(config);
  });
}

export function statPath(sftp: SFTPWrapper, path: string): Promise<{ isDirectory: boolean; size: number }> {
  return new Promise((resolve, reject) => {
    sftp.stat(path, (err, stats) => {
      if (err) return reject(err);
      resolve({ isDirectory: stats.isDirectory(), size: stats.size });
    });
  });
}

export function readdirEntries(sftp: SFTPWrapper, path: string): Promise<FileEntry[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(path, (err, list) => {
      if (err) return reject(err);
      resolve(
        list.map((item) => ({
          name: item.filename,
          type: modeToType(item.attrs.mode),
          size: item.attrs.size,
          modifiedAt: item.attrs.mtime * 1000,
        }))
      );
    });
  });
}

/** Best-effort: a directory that already exists (or can't be created for another reason we
 * can't easily distinguish over SFTP) is not treated as fatal — the copy just continues into it. */
export function mkdirIfMissing(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve) => {
    sftp.mkdir(path, () => resolve());
  });
}

/** Streams one file from `sourceSftp` straight into `destSftp` without buffering it in memory. */
export function streamCopy(
  sourceSftp: SFTPWrapper,
  sourcePath: string,
  destSftp: SFTPWrapper,
  destPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const readStream = sourceSftp.createReadStream(sourcePath);
    const writeStream = destSftp.createWriteStream(destPath);
    readStream.on("error", reject);
    writeStream.on("error", reject);
    writeStream.on("close", () => resolve());
    readStream.pipe(writeStream);
  });
}
