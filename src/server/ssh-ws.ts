import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { WebSocketServer, WebSocket } from "ws";
import { parse } from "url";
import { openSshChannel, type ExecTarget } from "@/lib/sshChannel";
import { logAudit } from "@/lib/db";
import { authenticateUpgrade, isSameOriginUpgrade } from "./wsAuth";

const SSH_WS_PATH = "/ws/ssh";
// A silent terminal (the user reading output without typing) sends no WS frames at all, and any
// reverse proxy sitting in front of this app (nginx, OpenLiteSpeed...) is liable to time out and
// drop an idle WebSocket connection well before the SSH keepalive below would ever notice — a
// ping every 20s keeps real traffic flowing through the whole path, well under the ~60s idle
// timeout most proxies default to, so the connection never looks idle to anything in between.
const HEARTBEAT_INTERVAL_MS = 20_000;

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
      const execKind = query.execKind === "pct" ? "pct" : "docker";
      const execTarget: ExecTarget | null = containerId ? { kind: execKind, id: containerId } : null;

      wss.handleUpgrade(req, socket, head, (ws) => {
        handleSshSession(ws, hostId, username, execTarget);
      });
    })().catch(() => {
      socket.destroy();
    });
  });

  return wss;
}

function handleSshSession(ws: WebSocket, hostId: number, username: string, execTarget: ExecTarget | null) {
  const send = (payload: object) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };

  const logTarget = execTarget ? `${hostId}/${execTarget.kind}:${execTarget.id}` : String(hostId);

  // openSshChannel() is called synchronously, right away — the SSH TCP handshake it kicks off
  // takes measurably longer than a single WS message round-trip, so the client's very first
  // "resize" message (sent on ws.onopen, before this function even returns to the event loop)
  // reliably arrives and calls handle.resize() before the channel's internal 'ready' handler reads
  // the size back out to build the PTY options — see sshChannel.ts's own comment for why that
  // buffering (not a synchronous handoff here) is what avoids the terminal-redraw-at-wrong-width
  // glitch this used to have.
  const handle = openSshChannel(hostId, execTarget, null, {
    onData: (chunk) => send({ type: "data", data: chunk }),
    onError: (message) => send({ type: "error", message }),
    onClose: () => send({ type: "closed" }),
  });

  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "input") handle.write(msg.data);
    else if (msg.type === "resize") handle.resize(msg.cols, msg.rows);
  });

  // Standard ws heartbeat pattern: a missed pong means the connection is actually dead (the
  // client-side socket disappeared without a clean close, e.g. a laptop going to sleep) — one
  // missed beat terminates rather than piling up zombie SSH sessions, since a spurious drop just
  // means the terminal falls back/reconnects like any other closed connection.
  let alive = true;
  ws.on("pong", () => {
    alive = true;
  });
  const heartbeat = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    ws.ping();
  }, HEARTBEAT_INTERVAL_MS);

  ws.on("close", () => {
    clearInterval(heartbeat);
    handle.close();
    logAudit("ssh.disconnected", logTarget, username);
  });

  logAudit("ssh.connected", logTarget, username);
}
