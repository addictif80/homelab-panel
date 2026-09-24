import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { WebSocketServer, WebSocket } from "ws";
import { parse } from "url";
import { connectSsh, buildPrivilegedCommand, shellQuote } from "@/lib/ssh";
import { getLogSource } from "@/lib/logSources";
import { analyzeLogLines } from "@/lib/logAnalysis";
import { getDetectionThresholds } from "@/lib/logAnalysisSettings";
import { authenticateUpgrade, isSameOriginUpgrade } from "./wsAuth";

const LOGS_WS_PATH = "/ws/logs";
const MAX_BUFFER_LINES = 500;

export function attachLogsWebSocketServer(server: import("http").Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const { pathname, query } = parse(req.url || "", true);
    if (pathname !== LOGS_WS_PATH) return;

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

      const sourceId = typeof query.sourceId === "string" ? query.sourceId : null;
      if (!sourceId) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        handleLogSession(ws, sourceId);
      });
    })().catch(() => {
      socket.destroy();
    });
  });

  return wss;
}

function handleLogSession(ws: WebSocket, sourceId: string) {
  const send = (payload: object) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };

  const source = getLogSource(sourceId);
  if (!source) {
    send({ type: "error", message: "Source de logs introuvable." });
    ws.close();
    return;
  }

  const tailCmd = source.filePath
    ? `docker exec ${shellQuote(source.containerId)} tail -n 50 -f ${shellQuote(source.filePath)}`
    : `docker logs -f --tail 50 ${shellQuote(source.containerId)}`;

  let command: string;
  let stdinPassword: string | null;
  try {
    ({ command, stdinPassword } = buildPrivilegedCommand(source.hostId, tailCmd));
  } catch (err) {
    send({ type: "error", message: err instanceof Error ? err.message : "Erreur de configuration." });
    ws.close();
    return;
  }

  let buffer: string[] = [];
  // The WebSocket can close before connectSsh's address fallback even finishes (multiple
  // addresses each take their own attempt) — tracked here so a connection that only becomes
  // ready after the client is already gone gets torn down immediately instead of left running.
  let wsClosed = false;
  ws.on("close", () => {
    wsClosed = true;
  });

  connectSsh(source.hostId)
    .then((conn) => {
      if (wsClosed) {
        conn.end();
        return;
      }
      conn.on("error", (err) => {
        send({ type: "error", message: err.message });
      });
      conn.exec(command, (err, stream) => {
        if (err) {
          send({ type: "error", message: err.message });
          conn.end();
          return;
        }
        if (stdinPassword) stream.write(`${stdinPassword}\n`);

        const handleChunk = (chunk: Buffer) => {
          const newLines = chunk.toString("utf8").split(/\r?\n/).filter((l) => l.length > 0);
          if (newLines.length === 0) return;

          buffer = [...buffer, ...newLines].slice(-MAX_BUFFER_LINES);
          send({ type: "lines", lines: newLines });
          send({ type: "suggestions", suggestions: analyzeLogLines(buffer, getDetectionThresholds()) });
        };

        stream.on("data", handleChunk);
        stream.stderr.on("data", handleChunk);
        stream.on("close", () => {
          send({ type: "closed" });
          conn.end();
        });

        ws.on("close", () => {
          stream.close();
          conn.end();
        });
      });
    })
    .catch((err) => {
      send({ type: "error", message: err instanceof Error ? err.message : "Erreur de connexion SSH." });
    });
}
