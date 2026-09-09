import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { WebSocketServer, WebSocket } from "ws";
import { Client as SshClient } from "ssh2";
import { parse } from "url";
import { buildSshConfig, buildPrivilegedCommand, getAutoElevatePassword, shellQuote } from "@/lib/ssh";
import { logAudit } from "@/lib/db";
import { authenticateUpgrade } from "./wsAuth";

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

  const wireChannel = (stream: import("ssh2").ClientChannel) => {
    stream.on("data", (data: Buffer) => send({ type: "data", data: data.toString("utf8") }));
    stream.stderr.on("data", (data: Buffer) => send({ type: "data", data: data.toString("utf8") }));
    stream.on("close", () => {
      send({ type: "closed" });
      conn.end();
    });

    ws.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === "input") stream.write(msg.data);
      else if (msg.type === "resize") stream.setWindow(msg.rows, msg.cols, 0, 0);
    });

    ws.on("close", () => {
      stream.close();
      conn.end();
      logAudit("ssh.disconnected", logTarget, username);
    });
  };

  conn.on("ready", () => {
    logAudit("ssh.connected", logTarget, username);

    if (dockerExec) {
      conn.exec(dockerExec.command, { pty: { term: "xterm-256color" } }, (err, stream) => {
        if (err) {
          send({ type: "error", message: err.message });
          conn.end();
          return;
        }
        if (dockerExec!.stdinPassword) stream.write(`${dockerExec!.stdinPassword}\n`);
        wireChannel(stream);
      });
      return;
    }

    conn.shell({ term: "xterm-256color" }, (err, stream) => {
      if (err) {
        send({ type: "error", message: err.message });
        conn.end();
        return;
      }
      wireChannel(stream);

      // Host needs sudo for anything privileged: drop the user straight into a root shell
      // instead of making them type `sudo -i` and a password we already hold in the vault.
      const sudoPassword = getAutoElevatePassword(hostId);
      if (sudoPassword) {
        stream.write("sudo -i\n");
        stream.write(`${sudoPassword}\n`);
      }
    });
  });

  conn.on("error", (err) => {
    send({ type: "error", message: err.message });
  });

  conn.connect(config);
}
