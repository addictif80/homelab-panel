"use client";

import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

// Some networks (hotels, rentals, corporate proxies) block the WebSocket upgrade outright rather
// than a specific port — plain HTTPS requests still go through fine there. If the WS connection
// hasn't opened within this window, it's treated the same as an outright refusal and the terminal
// falls back to the HTTP-polling transport instead of waiting indefinitely.
const WS_OPEN_TIMEOUT_MS = 3500;
const POLL_ERROR_BACKOFF_MS = 2000;

export default function Terminal({
  hostId,
  containerId,
  onStatusChange,
}: {
  hostId: number;
  containerId?: string;
  onStatusChange?: (status: "connecting" | "connected" | "closed" | "error", message?: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    let disposeTransport: (() => void) | null = null;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      theme: { background: "#0a0a0a" },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    onStatusChange?.("connecting");

    function startWs() {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const params = new URLSearchParams({ hostId: String(hostId) });
      if (containerId) params.set("containerId", containerId);
      const ws = new WebSocket(`${protocol}://${window.location.host}/ws/ssh?${params.toString()}`);

      let connectedOnce = false;
      let discarded = false;

      const abandonAndFallback = () => {
        if (discarded || cancelled) return;
        discarded = true;
        clearTimeout(openTimeout);
        ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
        try {
          ws.close();
        } catch {
          // already closing/closed
        }
        disposeTransport?.();
        startPolling();
      };

      const openTimeout = setTimeout(abandonAndFallback, WS_OPEN_TIMEOUT_MS);

      ws.onopen = () => {
        if (cancelled || discarded) return;
        clearTimeout(openTimeout);
        connectedOnce = true;
        onStatusChange?.("connected");
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      };

      ws.onmessage = (event) => {
        if (discarded) return;
        const msg = JSON.parse(event.data);
        if (msg.type === "data") term.write(msg.data);
        else if (msg.type === "error") {
          term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`);
          onStatusChange?.("error", msg.message);
        } else if (msg.type === "closed") {
          onStatusChange?.("closed");
        }
      };

      ws.onclose = () => {
        clearTimeout(openTimeout);
        if (cancelled || discarded) return;
        if (!connectedOnce) {
          // Closed without ever opening, before even our own timeout fired — most likely the
          // network refusing the WS upgrade outright. Fall back rather than assume it's an
          // expired session; the polling attempt below will surface a real auth error if that's
          // actually what happened.
          abandonAndFallback();
          return;
        }
        onStatusChange?.("closed");
      };

      ws.onerror = () => {
        if (cancelled || discarded || !connectedOnce) return; // let onclose decide — it always
        // follows onerror, and deciding here too would risk a spurious "error" flash right before
        // falling back to polling.
        onStatusChange?.("error", "Connexion WebSocket interrompue.");
      };

      const dataDisposable = term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data }));
      });

      const handleResize = () => {
        fitAddon.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      };
      window.addEventListener("resize", handleResize);
      // A plain window `resize` listener misses layout changes that don't come from the browser
      // window itself — a flex/grid container settling into its final size, a sidebar collapsing
      // — any of which leaves fitAddon's last measurement (and the size sent to the remote PTY)
      // stale without ever firing a window resize event.
      const resizeObserver = new ResizeObserver(() => handleResize());
      resizeObserver.observe(containerRef.current!);

      disposeTransport = () => {
        clearTimeout(openTimeout);
        window.removeEventListener("resize", handleResize);
        resizeObserver.disconnect();
        dataDisposable.dispose();
        ws.close();
      };
    }

    async function startPolling() {
      if (cancelled) return;
      onStatusChange?.("connecting", "Mode compatibilité — WebSocket indisponible sur ce réseau");

      let sessionId: string;
      try {
        const res = await fetch("/api/terminal-poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hostId, containerId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Connexion impossible.");
        sessionId = data.sessionId;
      } catch (err) {
        if (!cancelled) onStatusChange?.("error", err instanceof Error ? err.message : "Connexion impossible.");
        return;
      }
      if (cancelled) {
        fetch(`/api/terminal-poll/${sessionId}`, { method: "DELETE" }).catch(() => {});
        return;
      }

      onStatusChange?.("connected", "Mode compatibilité — WebSocket indisponible sur ce réseau");

      let cursor = 0;
      let stopped = false;

      (async function pollLoop() {
        while (!stopped && !cancelled) {
          try {
            const res = await fetch(`/api/terminal-poll/${sessionId}/output?cursor=${cursor}`);
            if (res.status === 404) {
              if (!stopped && !cancelled) onStatusChange?.("closed");
              return;
            }
            const data = await res.json();
            if (data.data) term.write(data.data);
            cursor = data.cursor;
            if (data.closed) {
              if (!stopped && !cancelled) onStatusChange?.("closed");
              return;
            }
          } catch {
            if (stopped || cancelled) return;
            await new Promise((resolve) => setTimeout(resolve, POLL_ERROR_BACKOFF_MS));
          }
        }
      })();

      const dataDisposable = term.onData((data) => {
        fetch(`/api/terminal-poll/${sessionId}/input`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data }),
        }).catch(() => {});
      });

      const sendResize = () => {
        fetch(`/api/terminal-poll/${sessionId}/resize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cols: term.cols, rows: term.rows }),
        }).catch(() => {});
      };
      const handleResize = () => {
        fitAddon.fit();
        sendResize();
      };
      window.addEventListener("resize", handleResize);
      const resizeObserver = new ResizeObserver(() => handleResize());
      resizeObserver.observe(containerRef.current!);
      sendResize();

      disposeTransport = () => {
        stopped = true;
        window.removeEventListener("resize", handleResize);
        resizeObserver.disconnect();
        dataDisposable.dispose();
        fetch(`/api/terminal-poll/${sessionId}`, { method: "DELETE" }).catch(() => {});
      };
    }

    startWs();

    return () => {
      cancelled = true;
      disposeTransport?.();
      term.dispose();
    };
  }, [hostId, containerId, onStatusChange]);

  return <div ref={containerRef} className="h-full w-full" />;
}
