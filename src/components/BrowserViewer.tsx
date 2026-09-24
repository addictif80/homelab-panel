"use client";

import { useEffect, useRef, useState } from "react";

// Frames come from a long-poll GET (see /api/browser/sessions/[id]/frame — resolves as soon as a
// new Page.screencastFrame arrives server-side), never a WebSocket, for the same reason as the SSH
// terminal's compatibility mode and the RDP viewer: it works on a network that blocks the WS
// upgrade outright. See lib/browserSession.ts for the server side (a real headless Chromium driven
// via puppeteer-core, streamed as JPEG frames over CDP).
const POLL_ERROR_BACKOFF_MS = 1500;

// Puppeteer's Keyboard.down/up resolves a string directly against its own USKeyboardLayout table,
// which already matches DOM KeyboardEvent.key 1:1 for letters, digits, punctuation, Enter,
// Backspace, Tab, Escape, arrows, Delete, Home/End, PageUp/Down, F1-F24 and space — only the
// modifier keys need translating, since puppeteer only defines left/right variants of those.
const KEY_MAP: Record<string, string> = {
  Shift: "ShiftLeft",
  Control: "ControlLeft",
  Alt: "AltLeft",
  Meta: "MetaLeft",
};

function toPuppeteerKey(e: React.KeyboardEvent): string {
  return KEY_MAP[e.key] ?? e.key;
}

const VIEWPORT = { width: 1280, height: 800 };

export default function BrowserViewer({
  initialUrl,
  onStatusChange,
  onTitleChange,
}: {
  initialUrl: string;
  onStatusChange?: (status: "connecting" | "connected" | "closed" | "error", message?: string) => void;
  onTitleChange?: (title: string) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [addressBar, setAddressBar] = useState(initialUrl);
  const sessionIdRef = useRef<string | null>(null);
  // Input requests are plain independent fetch() calls (no WebSocket to guarantee ordering), so a
  // mousedown fired right after a mousemove can otherwise reach the server first — the click lands
  // wherever the mouse was before that last move instead of where the user actually clicked. This
  // chain forces each input request to only start once the previous one has been sent and
  // answered, so the server always applies them in the order the user produced them.
  const inputChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const lastMouseMoveRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let sessionId: string | null = null;
    let stopped = false;
    let seq = 0;

    async function start() {
      onStatusChange?.("connecting");
      try {
        const res = await fetch("/api/browser/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: initialUrl }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Connexion impossible.");
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
        fetch(`/api/browser/sessions/${sessionId}`, { method: "DELETE" }).catch(() => {});
        return;
      }

      let hasConnected = false;
      (async function pollLoop() {
        while (!stopped && !cancelled) {
          try {
            const res = await fetch(`/api/browser/sessions/${sessionId}/frame?seq=${seq}`);
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
              onStatusChange?.(hasConnected ? "error" : "error", data.error);
              if (!hasConnected) setConnecting(false);
            } else {
              setError(null);
            }
            if (typeof data.url === "string") setAddressBar(data.url);
            if (typeof data.title === "string") onTitleChange?.(data.title || data.url);
            if (data.frame) {
              if (!hasConnected) {
                hasConnected = true;
                setConnecting(false);
                onStatusChange?.("connected");
              }
              setFrameUrl(`data:image/jpeg;base64,${data.frame}`);
              seq = data.seq;
            }
            if (data.closed) {
              onStatusChange?.("closed");
              return;
            }
          } catch {
            await new Promise((resolve) => setTimeout(resolve, POLL_ERROR_BACKOFF_MS));
          }
        }
      })();
    }

    start();

    return () => {
      cancelled = true;
      stopped = true;
      sessionIdRef.current = null;
      if (sessionId) fetch(`/api/browser/sessions/${sessionId}`, { method: "DELETE" }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);

  // Focuses the viewer the moment the first frame is ready, so typing works right away instead of
  // requiring a throwaway click first — but only if focus is still sitting on the page body (never
  // steals it away from the address bar or anything else the user is already interacting with).
  useEffect(() => {
    if (!connecting && imgRef.current && document.activeElement === document.body) {
      imgRef.current.focus();
    }
  }, [connecting]);

  function sendInput(input: object) {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    // Chained rather than fired independently — see inputChainRef's comment above. Each request
    // waits for the previous one to be answered before going out, so the server never processes a
    // click before the mouse-move that positioned it.
    inputChainRef.current = inputChainRef.current.then(() =>
      fetch(`/api/browser/sessions/${sessionId}/input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }).catch(() => {})
    );
  }

  function navigate(nav: object) {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    fetch(`/api/browser/sessions/${sessionId}/navigate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nav),
    }).catch(() => {});
  }

  function toRemoteCoords(e: React.MouseEvent<HTMLImageElement>) {
    const img = imgRef.current;
    if (!img) return { x: 0, y: 0 };
    const rect = img.getBoundingClientRect();
    const scaleX = VIEWPORT.width / rect.width;
    const scaleY = VIEWPORT.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  return (
    <div className="flex h-full w-full flex-col bg-black">
      <form
        className="flex shrink-0 items-center gap-1.5 border-b border-neutral-800 bg-neutral-900 px-2 py-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (addressBar.trim()) navigate({ action: "goto", url: addressBar.trim() });
        }}
      >
        <button
          type="button"
          title="Précédent"
          onClick={() => navigate({ action: "back" })}
          className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        >
          ←
        </button>
        <button
          type="button"
          title="Suivant"
          onClick={() => navigate({ action: "forward" })}
          className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        >
          →
        </button>
        <button
          type="button"
          title="Recharger"
          onClick={() => navigate({ action: "reload" })}
          className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        >
          ↻
        </button>
        <input
          value={addressBar}
          onChange={(e) => setAddressBar(e.target.value)}
          className="flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-100"
          spellCheck={false}
        />
      </form>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {connecting && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-400">
            Chargement du navigateur intégré…
          </div>
        )}
        {error && (
          <div className="absolute inset-x-0 top-0 z-10 bg-red-950/80 p-2 text-center text-xs text-red-300">
            {error}
          </div>
        )}
        {frameUrl && (
          <img
            ref={imgRef}
            src={frameUrl}
            alt="Page distante"
            draggable={false}
            className="max-h-full max-w-full select-none outline-none"
            onMouseMove={(e) => {
              // Throttled — mousemove otherwise fires on every pixel, and each one now waits in
              // line (see inputChainRef) behind whatever was queued before it, so an unthrottled
              // flood would delay the click that follows it by however long that backlog takes to
              // drain.
              const now = performance.now();
              if (now - lastMouseMoveRef.current < 35) return;
              lastMouseMoveRef.current = now;
              const { x, y } = toRemoteCoords(e);
              sendInput({ type: "mousemove", x, y });
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              // preventDefault() above also suppresses the browser's default click-to-focus
              // behavior for this element — without an explicit focus() call here, the image would
              // never actually hold keyboard focus, and every keydown/keyup below would silently go
              // nowhere (this was the "can't type anything" bug).
              e.currentTarget.focus();
              const { x, y } = toRemoteCoords(e);
              sendInput({ type: "mousemove", x, y });
              const button = e.button === 2 ? "right" : e.button === 1 ? "middle" : "left";
              sendInput({ type: "mousedown", button });
            }}
            onMouseUp={(e) => {
              e.preventDefault();
              const button = e.button === 2 ? "right" : e.button === 1 ? "middle" : "left";
              sendInput({ type: "mouseup", button });
            }}
            onWheel={(e) => {
              sendInput({ type: "wheel", deltaX: e.deltaX, deltaY: e.deltaY });
            }}
            onContextMenu={(e) => e.preventDefault()}
            tabIndex={0}
            onKeyDown={(e) => {
              e.preventDefault();
              sendInput({ type: "keydown", key: toPuppeteerKey(e) });
            }}
            onKeyUp={(e) => {
              e.preventDefault();
              sendInput({ type: "keyup", key: toPuppeteerKey(e) });
            }}
          />
        )}
      </div>
    </div>
  );
}
