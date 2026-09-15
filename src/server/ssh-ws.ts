import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { WebSocketServer, WebSocket } from "ws";
import { parse } from "url";
import { openSshChannel } from "@/lib/sshChannel";
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

  const logTarget = containerId ? `${hostId}/container:${containerId}` : String(hostId);

  // openSshChannel() is called synchronously, right away — the SSH TCP handshake it kicks off
  // takes measurably longer than a single WS message round-trip, so the client's very first
  // "resize" message (sent on ws.onopen, before this function even returns to the event loop)
  // reliably arrives and calls handle.resize() before the channel's internal 'ready' handler reads
  // the size back out to build the PTY options — see sshChannel.ts's own comment for why that
  // buffering (not a synchronous handoff here) is what avoids the terminal-redraw-at-wrong-width
  // glitch this used to have.
  const handle = openSshChannel(hostId, containerId, null, {
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

  ws.on("close", () => {
    handle.close();
    logAudit("ssh.disconnected", logTarget, username);
  });

  logAudit("ssh.connected", logTarget, username);
}
