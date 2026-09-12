"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Host = { id: number; name: string; kind: string };
type Link = { id: number; host_a_id: number; host_b_id: number; link_type: string };
type Pulse = { hostId: number; reachable: boolean; latencyMs: number | null; configured?: boolean };
type Tick = { recordedAt: string; pulses: Pulse[] };

const PULSE_POLL_MS = 4000;
const PLAYBACK_MS = 250;

const KIND_LABEL: Record<string, string> = {
  physical: "Physique",
  vm: "VM",
  lxc: "LXC",
  vps: "VPS",
  nas: "NAS",
  router: "Routeur",
};

const RANGE_OPTIONS: { label: string; hours: number }[] = [
  { label: "15 min", hours: 0.25 },
  { label: "1 h", hours: 1 },
  { label: "6 h", hours: 6 },
  { label: "24 h", hours: 24 },
];

function statusColor(pulse: Pulse | undefined): { core: string; ring: string } {
  if (!pulse || pulse.configured === false) return { core: "#737373", ring: "#3f3f46" };
  if (!pulse.reachable) return { core: "#ef4444", ring: "#7f1d1d" };
  if ((pulse.latencyMs ?? 0) > 150) return { core: "#f59e0b", ring: "#78350f" };
  return { core: "#34d399", ring: "#065f46" };
}

/** Faster heartbeat for a healthy, low-latency host; slower/off for a struggling or dead one —
 * the rhythm itself carries the health signal, not just the color, so the graph reads at a
 * glance even before you consciously register which node is which. */
function pulseDuration(pulse: Pulse | undefined): number {
  if (!pulse || !pulse.reachable) return 3.2;
  const latency = pulse.latencyMs ?? 50;
  return Math.min(2.4, Math.max(0.7, 0.7 + latency / 120));
}

function formatTickTime(iso: string): string {
  // recorded_at is stored as SQLite UTC "YYYY-MM-DD HH:MM:SS" — append Z so Date parses it as UTC
  // instead of (incorrectly) local time.
  return new Date(`${iso.replace(" ", "T")}Z`).toLocaleTimeString("fr-FR");
}

export default function LivingBrain() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [livePulses, setLivePulses] = useState<Map<number, Pulse>>(new Map());
  const [selected, setSelected] = useState<Host | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [mode, setMode] = useState<"live" | "history">("live");
  const [rangeHours, setRangeHours] = useState(1);
  const [history, setHistory] = useState<Tick[]>([]);
  const [tickIndex, setTickIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/hosts")
      .then((r) => r.json())
      .then((data) => {
        setHosts(data.hosts ?? []);
        setLinks(data.links ?? []);
      });
  }, []);

  useEffect(() => {
    if (mode !== "live") return;
    async function poll() {
      try {
        const res = await fetch("/api/brain");
        const data = await res.json();
        const next = new Map<number, Pulse>();
        for (const p of data.pulses as Pulse[]) next.set(p.hostId, p);
        setLivePulses(next);
      } catch {
        // A missed beat isn't an outage — just try again next tick.
      }
    }
    poll();
    pollRef.current = setInterval(poll, PULSE_POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [mode]);

  async function enterHistory() {
    setPlaying(false);
    setMode("history");
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/brain/history?hours=${rangeHours}`);
      const data = await res.json();
      setHistory(data.ticks ?? []);
      setTickIndex(Math.max((data.ticks?.length ?? 1) - 1, 0));
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (mode === "history") enterHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeHours]);

  useEffect(() => {
    if (playing && mode === "history") {
      playRef.current = setInterval(() => {
        setTickIndex((i) => {
          if (i >= history.length - 1) {
            setPlaying(false);
            return i;
          }
          return i + 1;
        });
      }, PLAYBACK_MS);
    }
    return () => {
      if (playRef.current) clearInterval(playRef.current);
    };
  }, [playing, mode, history.length]);

  const pulses = useMemo(() => {
    if (mode === "live") return livePulses;
    const tick = history[tickIndex];
    const map = new Map<number, Pulse>();
    if (tick) for (const p of tick.pulses) map.set(p.hostId, p);
    return map;
  }, [mode, livePulses, history, tickIndex]);

  const width = 900;
  const height = 620;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2 - 90;

  const positions = new Map<number, { x: number; y: number }>();
  hosts.forEach((h, i) => {
    const angle = (i / Math.max(hosts.length, 1)) * 2 * Math.PI - Math.PI / 2;
    positions.set(h.id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  });

  const reachableCount = hosts.filter((h) => pulses.get(h.id)?.reachable).length;

  return (
    <div className="rounded border border-neutral-800 bg-black">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-900 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-100">Vue vivante</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            {mode === "live"
              ? `${reachableCount}/${hosts.length} machines qui répondent — en direct.`
              : history.length === 0
                ? "Pas encore d'historique enregistré sur cette période."
                : `${reachableCount}/${hosts.length} machines — ${formatTickTime(history[tickIndex]?.recordedAt ?? "")}`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded border border-neutral-700 text-xs">
            <button
              onClick={() => setMode("live")}
              className={`px-2.5 py-1 ${mode === "live" ? "bg-emerald-900/40 text-emerald-300" : "text-neutral-400"}`}
            >
              ● Direct
            </button>
            <button
              onClick={enterHistory}
              className={`px-2.5 py-1 ${mode === "history" ? "bg-blue-900/40 text-blue-300" : "text-neutral-400"}`}
            >
              ⏪ Boîte noire
            </button>
          </div>
          {selected && (
            <div className="text-right text-xs">
              <div className="font-medium text-neutral-100">{selected.name}</div>
              <div className="text-neutral-500">
                {KIND_LABEL[selected.kind] ?? selected.kind} ·{" "}
                {(() => {
                  const p = pulses.get(selected.id);
                  if (!p || p.configured === false) return "aucune IP renseignée";
                  return p.reachable ? `${p.latencyMs ?? "?"} ms` : "injoignable";
                })()}
              </div>
            </div>
          )}
        </div>
      </div>

      {mode === "history" && (
        <div className="flex flex-wrap items-center gap-3 border-b border-neutral-900 bg-neutral-950 px-4 py-2.5">
          <div className="flex rounded border border-neutral-700 text-xs">
            {RANGE_OPTIONS.map((r) => (
              <button
                key={r.hours}
                onClick={() => setRangeHours(r.hours)}
                className={`px-2 py-1 ${rangeHours === r.hours ? "bg-blue-900/40 text-blue-300" : "text-neutral-400"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setPlaying((p) => !p)}
            disabled={history.length < 2}
            className="rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-40"
          >
            {playing ? "⏸ Pause" : "▶ Rejouer"}
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(history.length - 1, 0)}
            value={tickIndex}
            onChange={(e) => {
              setPlaying(false);
              setTickIndex(Number(e.target.value));
            }}
            disabled={history.length < 2}
            className="min-w-[160px] flex-1"
          />
          <span className="whitespace-nowrap text-xs text-neutral-500">
            {historyLoading ? "Chargement..." : `${tickIndex + 1}/${history.length || 1}`}
          </span>
        </div>
      )}

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ maxHeight: 620 }}>
        <defs>
          <filter id="brain-glow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {links.map((l) => {
          const a = positions.get(l.host_a_id);
          const b = positions.get(l.host_b_id);
          if (!a || !b) return null;
          const alive = pulses.get(l.host_a_id)?.reachable && pulses.get(l.host_b_id)?.reachable;
          return (
            <line
              key={l.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={alive ? "#34d399" : "#3f3f46"}
              strokeWidth={alive ? 1.5 : 1}
              strokeOpacity={alive ? 0.6 : 0.35}
              strokeDasharray={alive ? "4 6" : undefined}
              className={alive && mode === "live" ? "brain-flow" : undefined}
            />
          );
        })}

        {hosts.map((h) => {
          const p = positions.get(h.id);
          if (!p) return null;
          const pulse = pulses.get(h.id);
          const { core, ring } = statusColor(pulse);
          const duration = pulseDuration(pulse);
          return (
            <g
              key={h.id}
              transform={`translate(${p.x}, ${p.y})`}
              onClick={() => setSelected(h)}
              style={{ cursor: "pointer" }}
            >
              <circle r={16} fill="none" stroke={ring} strokeWidth={1.5} opacity={0.5} />
              <circle
                r={9}
                fill={core}
                filter="url(#brain-glow)"
                className={mode === "live" ? "brain-node" : undefined}
                style={mode === "live" ? { animationDuration: `${duration}s` } : undefined}
              />
              <text y={32} textAnchor="middle" fontSize={11} fill="#d4d4d4" style={{ userSelect: "none" }}>
                {h.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
