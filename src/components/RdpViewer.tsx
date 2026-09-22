"use client";

import { useEffect, useRef, useState } from "react";

// Frames are plain HTTP GET/POST — never a WebSocket — since the whole point of this viewer is to
// work on a network that blocks the WS upgrade outright (see lib/rdp/session.ts for the server
// side: Xvfb + xfreerdp rendered off-screen, polled as PNG screenshots).
const FRAME_POLL_MS = 400;

const KEY_MAP: Record<string, string> = {
  Enter: "Return",
  Backspace: "BackSpace",
  Tab: "Tab",
  Escape: "Escape",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  PageUp: "Prior",
  PageDown: "Next",
  " ": "space",
  Shift: "shift",
  Control: "ctrl",
  Alt: "alt",
  Meta: "super",
  CapsLock: "Caps_Lock",
};

function toXdotoolKey(e: React.KeyboardEvent): string | null {
  if (KEY_MAP[e.key]) return KEY_MAP[e.key];
  if (e.key.length === 1) return e.key;
  if (/^F\d{1,2}$/.test(e.key)) return e.key;
  return null;
}

export default function RdpViewer({ hostId, onStatusChange }: { hostId: number; onStatusChange?: (status: string, message?: string) => void }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const naturalSizeRef = useRef({ w: 1280, h: 800 });
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let sessionId: string | null = null;
    let stopped = false;
    let lastFrameUrl: string | null = null;

    async function start() {
      onStatusChange?.("connecting");
      try {
        const res = await fetch("/api/rdp/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hostId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Connexion RDP impossible.");
        sessionId = data.sessionId;
        sessionIdRef.current = sessionId;
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Connexion impossible.";
          setError(message);
          setConnecting(false);
          onStatusChange?.("error", message);
        }
        return;
      }

      if (cancelled) {
        fetch(`/api/rdp/sessions/${sessionId}`, { method: "DELETE" }).catch(() => {});
        return;
      }

      let hasConnected = false;
      (async function pollLoop() {
        while (!stopped && !cancelled) {
          try {
            const res = await fetch(`/api/rdp/sessions/${sessionId}/frame`);
            if (res.status === 404) {
              if (!stopped && !cancelled) {
                setError("Session fermée.");
                onStatusChange?.("closed");
              }
              return;
            }
            const data = await res.json();
            if (data.error) {
              setError(data.error);
              setConnecting(false);
              onStatusChange?.("error", data.error);
              if (data.closed) return;
            } else if (data.frame) {
              if (!hasConnected) {
                hasConnected = true;
                setConnecting(false);
                onStatusChange?.("connected");
              }
              setError(null);
              const url = `data:image/png;base64,${data.frame}`;
              if (lastFrameUrl && lastFrameUrl.startsWith("blob:")) URL.revokeObjectURL(lastFrameUrl);
              lastFrameUrl = url;
              setFrameUrl(url);
            }
            if (data.closed) {
              onStatusChange?.("closed");
              return;
            }
          } catch {
            // transient — keep polling
          }
          await new Promise((resolve) => setTimeout(resolve, FRAME_POLL_MS));
        }
      })();
    }

    start();

    return () => {
      cancelled = true;
      stopped = true;
      sessionIdRef.current = null;
      if (sessionId) fetch(`/api/rdp/sessions/${sessionId}`, { method: "DELETE" }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId]);

  function sendInput(input: object) {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    fetch(`/api/rdp/sessions/${sessionId}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).catch(() => {});
  }

  function toRemoteCoords(e: React.MouseEvent<HTMLImageElement>) {
    const img = imgRef.current;
    if (!img) return { x: 0, y: 0 };
    const rect = img.getBoundingClientRect();
    const scaleX = naturalSizeRef.current.w / rect.width;
    const scaleY = naturalSizeRef.current.h / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  return (
    <div ref={containerRef} className="relative flex h-full w-full items-center justify-center bg-black">
      {connecting && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-400">
          Connexion au bureau distant…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-red-400">
          {error}
        </div>
      )}
      {frameUrl && (
        <img
          ref={imgRef}
          src={frameUrl}
          alt="Bureau distant"
          draggable={false}
          className="max-h-full max-w-full select-none"
          onLoad={(e) => {
            naturalSizeRef.current = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight };
          }}
          onMouseMove={(e) => {
            const { x, y } = toRemoteCoords(e);
            sendInput({ type: "mousemove", x, y });
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            sendInput({ type: "mousedown", button: e.button + 1 });
          }}
          onMouseUp={(e) => {
            e.preventDefault();
            sendInput({ type: "mouseup", button: e.button + 1 });
          }}
          onWheel={(e) => {
            sendInput({ type: "scroll", deltaY: e.deltaY });
          }}
          onContextMenu={(e) => e.preventDefault()}
          tabIndex={0}
          onKeyDown={(e) => {
            e.preventDefault();
            const key = toXdotoolKey(e);
            if (key) sendInput({ type: "keydown", key });
          }}
          onKeyUp={(e) => {
            e.preventDefault();
            const key = toXdotoolKey(e);
            if (key) sendInput({ type: "keyup", key });
          }}
        />
      )}
    </div>
  );
}
