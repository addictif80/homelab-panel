import { Client as SshClient, type SFTPWrapper } from "ssh2";
import { buildSshConfig } from "./ssh";

export type FileEntry = {
  name: string;
  type: "file" | "directory" | "symlink" | "other";
  size: number;
  modifiedAt: number;
};

function withSftp<T>(hostId: number, fn: (sftp: SFTPWrapper, conn: SshClient) => Promise<T>): Promise<T> {
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
