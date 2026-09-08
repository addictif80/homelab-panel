import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { WebSocketServer, WebSocket } from "ws";
import { Client as SshClient } from "ssh2";
import { parse } from "url";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { buildSshConfig } from "@/lib/ssh";
import { logAudit } from "@/lib/db";

const SSH_WS_PATH = "/ws/ssh";

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

export function attachSshWebSocketServer(server: import("http").Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const { pathname, query } = parse(req.url || "", true);
    if (pathname !== SSH_WS_PATH) return;

    (async () => {
      const token = parseCookie(req.headers.cookie, SESSION_COOKIE_NAME);
      const username = token ? await verifySessionToken(token) : null;
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

      wss.handleUpgrade(req, socket, head, (ws) => {
        handleSshSession(ws, hostId, username);
      });
    })().catch(() => {
      socket.destroy();
    });
  });

  return wss;
}

function handleSshSession(ws: WebSocket, hostId: number, username: string) {
  const send = (payload: object) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };

  let config;
  try {
    config = buildSshConfig(hostId);
  } catch (err) {
    send({ type: "error", message: err instanceof Error ? err.message : "Erreur de configuration SSH." });
    ws.close();
    return;
  }

  const conn = new SshClient();

  conn.on("ready", () => {
    logAudit("ssh.connected", String(hostId), username);
    conn.shell({ term: "xterm-256color" }, (err, stream) => {
      if (err) {
        send({ type: "error", message: err.message });
        conn.end();
        return;
      }

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
        logAudit("ssh.disconnected", String(hostId), username);
      });
    });
  });

  conn.on("error", (err) => {
    send({ type: "error", message: err.message });
  });

  conn.connect(config);
}
