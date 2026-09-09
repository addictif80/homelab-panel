"use client";

import { useEffect, useRef, useState } from "react";
import { reasonLabel, type SuspiciousReason } from "@/lib/logAnalysis";

type Suggestion = {
  ip: string;
  reasons: SuspiciousReason[];
  counts: { authFailure: number; notFound: number; total: number };
};

const MAX_DISPLAY_LINES = 300;

export default function LiveLogPanel({ sourceId }: { sourceId: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [status, setStatus] = useState<"connecting" | "live" | "error" | "closed">("connecting");
  const [errorMessage, setErrorMessage] = useState("");
  const [blocking, setBlocking] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws/logs?sourceId=${sourceId}`);

    ws.onopen = () => setStatus("live");
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "lines") {
        setLines((l) => [...l, ...msg.lines].slice(-MAX_DISPLAY_LINES));
        requestAnimationFrame(() => {
          const el = containerRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
      } else if (msg.type === "suggestions") {
        setSuggestions(msg.suggestions);
      } else if (msg.type === "error") {
        setStatus("error");
        setErrorMessage(msg.message);
      } else if (msg.type === "closed") {
        setStatus("closed");
      }
    };
    ws.onerror = () => setStatus("error");
    ws.onclose = () => setStatus((s) => (s === "error" ? s : "closed"));

    return () => ws.close();
  }, [sourceId]);

  async function blockIp(ip: string) {
    setBlocking(ip);
    try {
      const res = await fetch(`/api/logs/sources/${sourceId}/block`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBlocked((b) => new Set(b).add(ip));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Erreur de blocage.");
    } finally {
      setBlocking(null);
    }
  }

  return (
    <div className="space-y-2">
      {suggestions.length > 0 && (
        <div className="space-y-1">
          {suggestions.map((s) => (
            <div
              key={s.ip}
              className="flex items-center justify-between rounded border border-amber-900/50 bg-amber-950/30 px-3 py-1.5 text-xs"
            >
              <span>
                <span className="font-mono text-amber-300">{s.ip}</span>{" "}
                <span className="text-amber-500">— {s.reasons.map(reasonLabel).join(", ")}</span>
              </span>
              {blocked.has(s.ip) ? (
                <span className="text-neutral-500">bloquée</span>
              ) : (
                <button
                  onClick={() => blockIp(s.ip)}
                  disabled={blocking === s.ip}
                  className="rounded border border-amber-700 px-2 py-0.5 text-amber-300 hover:bg-amber-900/40 disabled:opacity-50"
                >
                  {blocking === s.ip ? "..." : "Bloquer"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div
        ref={containerRef}
        className="h-40 overflow-auto border-t border-neutral-800 bg-black p-3 font-mono text-xs text-neutral-300"
      >
        {status === "connecting" && <div className="text-neutral-500">Connexion...</div>}
        {status === "error" && <div className="text-red-400">Erreur: {errorMessage}</div>}
        {lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
        {status === "closed" && <div className="text-neutral-500">— flux terminé —</div>}
      </div>
    </div>
  );
}
