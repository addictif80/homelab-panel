import { Client as SshClient } from "ssh2";
import { buildSshConfig, buildPrivilegedCommand, getAutoElevatePassword, shellQuote } from "./ssh";

/**
 * The actual "connect, optionally exec into a Docker container or a Proxmox LXC, allocate a PTY,
 * auto-elevate with sudo" logic behind an interactive shell — pulled out of ssh-ws.ts so both the
 * WebSocket terminal and the HTTP-polling fallback (see terminalPollSessions.ts, for networks that
 * block the WebSocket upgrade outright) share one implementation instead of two copies that could
 * drift. A Proxmox VM has no equivalent here — `pct exec` works because an LXC shares the host's
 * kernel, but a VM is a fully isolated machine that needs its own SSH credentials to reach a shell
 * inside it (see the Proxmox page, which only offers a Terminal button for a VM when its
 * guest-agent-reported IP happens to match an already-configured host).
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

export type ExecTarget = { kind: "docker" | "pct"; id: string };

export function openSshChannel(
  hostId: number,
  execTarget: ExecTarget | null,
  initialSize: { cols: number; rows: number } | null,
  callbacks: SshChannelCallbacks
): SshChannelHandle {
  let config: ReturnType<typeof buildSshConfig>;
  let execCommand: { command: string; stdinPassword: string | null } | null = null;
  try {
    config = buildSshConfig(hostId);
    if (execTarget?.kind === "docker") {
      const dockerCmd = `docker exec -it ${shellQuote(execTarget.id)} sh -c 'exec bash || exec sh'`;
      execCommand = buildPrivilegedCommand(hostId, dockerCmd);
    } else if (execTarget?.kind === "pct") {
      // `pct exec` (unlike `docker exec`) always needs root on the Proxmox node itself — it's not
      // gated by whatever `needs_sudo` says about this host's normal SSH login, since a Proxmox
      // node is customarily managed as root anyway. buildPrivilegedCommand still only adds `sudo`
      // when the host is actually configured to need it, same as every other privileged command.
      const pctCmd = `pct exec ${Number(execTarget.id)} -- bash -l`;
      execCommand = buildPrivilegedCommand(hostId, pctCmd);
    }
  } catch (err) {
    // Deferred so the caller can finish registering the handle before onError can trigger any
    // synchronous cleanup that assumes the handle already exists.
    queueMicrotask(() => callbacks.onError(err instanceof Error ? err.message : "Erreur de configuration SSH."));
    return { write: () => {}, resize: () => {}, close: () => {} };
  }

  let conn = new SshClient();

  // See ssh-ws.ts's original comment: the caller's initial size (and any input) can race ahead of
  // the SSH handshake + shell allocation, so both are buffered here and flushed once the channel
  // exists instead of being silently dropped.
  let stream: import("ssh2").ClientChannel | null = null;
  let pendingResize = initialSize;
  const pendingInput: string[] = [];
  let closed = false;

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

  const onReady = () => {
    // Past this point the connection is real and staying up for the whole session — any further
    // 'error' (a mid-session drop) goes straight to the caller, not through the connect-retry path.
    conn.on("error", (err) => callbacks.onError(err.message));

    const ptyOptions = {
      term: "xterm-256color",
      ...(pendingResize ? { cols: pendingResize.cols, rows: pendingResize.rows } : {}),
    };

    if (execCommand) {
      conn.exec(execCommand.command, { pty: ptyOptions }, (err, newStream) => {
        if (err) {
          callbacks.onError(err.message);
          conn.end();
          return;
        }
        if (execCommand!.stdinPassword) newStream.write(`${execCommand!.stdinPassword}\n`);
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
  };

  // Some NAS-grade sshd (ZimaOS's very lightweight one in particular) intermittently drops a
  // brand new connection attempt before the handshake completes — "Connection lost before
  // handshake" / ECONNRESET — under momentary load, with no shell/exec requested yet at that
  // point. Retrying the connect itself a few times with backoff clears the overwhelming majority
  // of these instead of failing a terminal open outright (same retry budget as the SFTP browser
  // in lib/sftp.ts, for the same class of host).
  const CONNECT_RETRY_DELAYS_MS = [800, 2000, 4000, 6000];

  function attemptConnect(remaining: number[]) {
    conn.once("ready", onReady);
    conn.once("error", (err) => {
      if (closed) return;
      if (remaining.length > 0 && /connection lost before handshake|econnreset|timed out while waiting for handshake/i.test(err.message)) {
        const [delay, ...rest] = remaining;
        setTimeout(() => {
          if (closed) return;
          conn = new SshClient();
          attemptConnect(rest);
        }, delay);
        return;
      }
      callbacks.onError(err.message);
    });
    conn.connect(config);
  }

  attemptConnect(CONNECT_RETRY_DELAYS_MS);

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
      closed = true;
      stream?.close();
      conn.end();
    },
  };
}
