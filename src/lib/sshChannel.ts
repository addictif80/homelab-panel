import { Client as SshClient } from "ssh2";
import { buildSshConfig, buildPrivilegedCommand, getAutoElevatePassword, shellQuote } from "./ssh";

/**
 * The actual "connect, optionally exec into a Docker container, allocate a PTY, auto-elevate with
 * sudo" logic behind an interactive shell — pulled out of ssh-ws.ts so both the WebSocket terminal
 * and the HTTP-polling fallback (see terminalPollSessions.ts, for networks that block the
 * WebSocket upgrade outright) share one implementation instead of two copies that could drift.
 */

export type SshChannelHandle = {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
};

export type SshChannelCallbacks = {
  onData: (chunk: string) => void;
  onError: (message: string) => void;
  onClose: () => void;
};

export function openSshChannel(
  hostId: number,
  containerId: string | null,
  initialSize: { cols: number; rows: number } | null,
  callbacks: SshChannelCallbacks
): SshChannelHandle {
  let config: ReturnType<typeof buildSshConfig>;
  let dockerExec: { command: string; stdinPassword: string | null } | null = null;
  try {
    config = buildSshConfig(hostId);
    if (containerId) {
      const dockerCmd = `docker exec -it ${shellQuote(containerId)} sh -c 'exec bash || exec sh'`;
      dockerExec = buildPrivilegedCommand(hostId, dockerCmd);
    }
  } catch (err) {
    // Deferred so the caller can finish registering the handle before onError can trigger any
    // synchronous cleanup that assumes the handle already exists.
    queueMicrotask(() => callbacks.onError(err instanceof Error ? err.message : "Erreur de configuration SSH."));
    return { write: () => {}, resize: () => {}, close: () => {} };
  }

  const conn = new SshClient();

  // See ssh-ws.ts's original comment: the caller's initial size (and any input) can race ahead of
  // the SSH handshake + shell allocation, so both are buffered here and flushed once the channel
  // exists instead of being silently dropped.
  let stream: import("ssh2").ClientChannel | null = null;
  let pendingResize = initialSize;
  const pendingInput: string[] = [];

  const wireChannel = (newStream: import("ssh2").ClientChannel) => {
    stream = newStream;
    if (pendingResize) newStream.setWindow(pendingResize.rows, pendingResize.cols, 0, 0);
    for (const data of pendingInput.splice(0)) newStream.write(data);

    newStream.on("data", (data: Buffer) => callbacks.onData(data.toString("utf8")));
    newStream.stderr.on("data", (data: Buffer) => callbacks.onData(data.toString("utf8")));
    newStream.on("close", () => {
      callbacks.onClose();
      conn.end();
    });
  };

  conn.on("ready", () => {
    const ptyOptions = {
      term: "xterm-256color",
      ...(pendingResize ? { cols: pendingResize.cols, rows: pendingResize.rows } : {}),
    };

    if (dockerExec) {
      conn.exec(dockerExec.command, { pty: ptyOptions }, (err, newStream) => {
        if (err) {
          callbacks.onError(err.message);
          conn.end();
          return;
        }
        if (dockerExec!.stdinPassword) newStream.write(`${dockerExec!.stdinPassword}\n`);
        wireChannel(newStream);
      });
      return;
    }

    conn.shell(ptyOptions, (err, newStream) => {
      if (err) {
        callbacks.onError(err.message);
        conn.end();
        return;
      }
      wireChannel(newStream);

      const sudoPassword = getAutoElevatePassword(hostId);
      if (sudoPassword) {
        newStream.write("sudo -i\n");
        newStream.write(`${sudoPassword}\n`);
      }
    });
  });

  conn.on("error", (err) => callbacks.onError(err.message));
  conn.connect(config);

  return {
    write: (data) => {
      if (stream) stream.write(data);
      else pendingInput.push(data);
    },
    resize: (cols, rows) => {
      pendingResize = { cols, rows };
      if (stream) stream.setWindow(rows, cols, 0, 0);
    },
    close: () => {
      stream?.close();
      conn.end();
    },
  };
}
