"use client";

import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export default function Terminal({
  hostId,
  onStatusChange,
}: {
  hostId: number;
  onStatusChange?: (status: "connecting" | "connected" | "closed" | "error", message?: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      theme: { background: "#0a0a0a" },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws/ssh?hostId=${hostId}`);
    wsRef.current = ws;
    onStatusChange?.("connecting");

    ws.onopen = () => {
      onStatusChange?.("connected");
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "data") term.write(msg.data);
      else if (msg.type === "error") {
        term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`);
        onStatusChange?.("error", msg.message);
      } else if (msg.type === "closed") {
        onStatusChange?.("closed");
      }
    };

    ws.onclose = () => onStatusChange?.("closed");
    ws.onerror = () => onStatusChange?.("error", "Connexion WebSocket interrompue.");

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

    return () => {
      window.removeEventListener("resize", handleResize);
      dataDisposable.dispose();
      ws.close();
      term.dispose();
    };
  }, [hostId, onStatusChange]);

  return <div ref={containerRef} className="h-full w-full" />;
}
