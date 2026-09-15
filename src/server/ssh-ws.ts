import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { WebSocketServer, WebSocket } from "ws";
import { Client as SshClient } from "ssh2";
import { parse } from "url";
import { buildSshConfig, buildPrivilegedCommand, getAutoElevatePassword, shellQuote } from "@/lib/ssh";
import { logAudit } from "@/lib/db";
import { authenticateUpgrade, isSameOriginUpgrade } from "./wsAuth";

const SSH_WS_PATH = "/ws/ssh";

type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

export function attachSshWebSocketServer(server: import("http").Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const { pathname, query } = parse(req.url || "", true);
    if (pathname !== SSH_WS_PATH) return;

    (async () => {
      if (!isSameOriginUpgrade({ origin: req.headers.origin, host: req.headers.host })) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }

      const username = await authenticateUpgrade(req.headers.cookie);
      if (!username) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      const hostId = Number(query.hostId);
      if (!hostId) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }
      const containerId = typeof query.containerId === "string" ? query.containerId : null;

      wss.handleUpgrade(req, socket, head, (ws) => {
        handleSshSession(ws, hostId, username, containerId);
      });
    })().catch(() => {
      socket.destroy();
    });
  });

  return wss;
}

function handleSshSession(ws: WebSocket, hostId: number, username: string, containerId: string | null) {
  const send = (payload: object) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };

  let config;
  let dockerExec: { command: string; stdinPassword: string | null } | null = null;
  try {
    config = buildSshConfig(hostId);
    if (containerId) {
      const dockerCmd = `docker exec -it ${shellQuote(containerId)} sh -c 'exec bash || exec sh'`;
      dockerExec = buildPrivilegedCommand(hostId, dockerCmd);
    }
  } catch (err) {
    send({ type: "error", message: err instanceof Error ? err.message : "Erreur de configuration SSH." });
    ws.close();
    return;
  }

  const conn = new SshClient();
  const logTarget = containerId ? `${hostId}/container:${containerId}` : String(hostId);

  // The client sends its initial size (and any keystrokes) as soon as the WebSocket itself opens
  // — which can easily race ahead of the SSH handshake + shell allocation, since that involves a
  // real TCP connection, key exchange and auth to the target host. Attaching the message listener
  // only once the shell/exec stream exists (as this used to) silently dropped anything sent
  // during that window: the remote PTY stayed at ssh2's default size (80x24) until the *next*
  // resize event (a window resize, if any), so a readline redraw (e.g. recalling history with the
  // up arrow) computed its cursor movement for a width that didn't match what xterm.js was
  // actually rendering — the exact "input line redraws over an earlier command" symptom. Buffering
  // here instead means the very first `conn.shell()`/`conn.exec()` call below can request the PTY
  // at the *correct* size from the start, and nothing typed before the shell is ready gets lost.
  let stream: import("ssh2").ClientChannel | null = null;
  let pendingResize: { cols: number; rows: number } | null = null;
  const pendingInput: string[] = [];

  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "input") {
      if (stream) stream.write(msg.data);
      else pendingInput.push(msg.data);
    } else if (msg.type === "resize") {
      pendingResize = { cols: msg.cols, rows: msg.rows };
      if (stream) stream.setWindow(msg.rows, msg.cols, 0, 0);
    }
  });

  ws.on("close", () => {
    stream?.close();
    conn.end();
    logAudit("ssh.disconnected", logTarget, username);
  });

  const wireChannel = (newStream: import("ssh2").ClientChannel) => {
    stream = newStream;
    if (pendingResize) newStream.setWindow(pendingResize.rows, pendingResize.cols, 0, 0);
    for (const data of pendingInput.splice(0)) newStream.write(data);

    newStream.on("data", (data: Buffer) => send({ type: "data", data: data.toString("utf8") }));
    newStream.stderr.on("data", (data: Buffer) => send({ type: "data", data: data.toString("utf8") }));
    newStream.on("close", () => {
      send({ type: "closed" });
      conn.end();
    });
  };

  conn.on("ready", () => {
    logAudit("ssh.connected", logTarget, username);
    const ptyOptions = {
      term: "xterm-256color",
      ...(pendingResize ? { cols: pendingResize.cols, rows: pendingResize.rows } : {}),
    };

    if (dockerExec) {
      conn.exec(dockerExec.command, { pty: ptyOptions }, (err, newStream) => {
        if (err) {
          send({ type: "error", message: err.message });
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
        send({ type: "error", message: err.message });
        conn.end();
        return;
      }
      wireChannel(newStream);

      // Host needs sudo for anything privileged: drop the user straight into a root shell
      // instead of making them type `sudo -i` and a password we already hold in the vault.
      const sudoPassword = getAutoElevatePassword(hostId);
      if (sudoPassword) {
        newStream.write("sudo -i\n");
        newStream.write(`${sudoPassword}\n`);
      }
    });
  });

  conn.on("error", (err) => {
    send({ type: "error", message: err.message });
  });

  conn.connect(config);
}
