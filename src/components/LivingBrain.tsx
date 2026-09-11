"use client";

import { useEffect, useRef, useState } from "react";

type Host = { id: number; name: string; kind: string };
type Link = { id: number; host_a_id: number; host_b_id: number; link_type: string };
type Pulse = { hostId: number; reachable: boolean; latencyMs: number | null; configured: boolean };

const PULSE_POLL_MS = 4000;

const KIND_LABEL: Record<string, string> = {
  physical: "Physique",
  vm: "VM",
  lxc: "LXC",
  vps: "VPS",
  nas: "NAS",
  router: "Routeur",
};

function statusColor(pulse: Pulse | undefined): { core: string; glow: string; ring: string } {
  if (!pulse || !pulse.configured) return { core: "#737373", glow: "#737373", ring: "#3f3f46" };
  if (!pulse.reachable) return { core: "#ef4444", glow: "#ef4444", ring: "#7f1d1d" };
  if ((pulse.latencyMs ?? 0) > 150) return { core: "#f59e0b", glow: "#f59e0b", ring: "#78350f" };
  return { core: "#34d399", glow: "#34d399", ring: "#065f46" };
}

/** Faster heartbeat for a healthy, low-latency host; slower/off for a struggling or dead one —
 * the rhythm itself carries the health signal, not just the color, so the graph reads at a
 * glance even before you consciously register which node is which. */
function pulseDuration(pulse: Pulse | undefined): number {
  if (!pulse || !pulse.reachable) return 3.2;
  const latency = pulse.latencyMs ?? 50;
  return Math.min(2.4, Math.max(0.7, 0.7 + latency / 120));
}

export default function LivingBrain() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [pulses, setPulses] = useState<Map<number, Pulse>>(new Map());
  const [selected, setSelected] = useState<Host | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/hosts")
      .then((r) => r.json())
      .then((data) => {
        setHosts(data.hosts ?? []);
        setLinks(data.links ?? []);
      });
  }, []);

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch("/api/brain");
        const data = await res.json();
        const next = new Map<number, Pulse>();
        for (const p of data.pulses as Pulse[]) next.set(p.hostId, p);
        setPulses(next);
      } catch {
        // A missed beat isn't an outage — just try again next tick.
      }
    }
    poll();
    timerRef.current = setInterval(poll, PULSE_POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

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
      <div className="flex items-center justify-between border-b border-neutral-900 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-100">Vue vivante</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            {reachableCount}/{hosts.length} machines qui répondent — pulsation liée à la latence réelle.
          </p>
        </div>
        {selected && (
          <div className="text-right text-xs">
            <div className="font-medium text-neutral-100">{selected.name}</div>
            <div className="text-neutral-500">
              {KIND_LABEL[selected.kind] ?? selected.kind} ·{" "}
              {(() => {
                const p = pulses.get(selected.id);
                if (!p?.configured) return "aucune IP renseignée";
                return p.reachable ? `${p.latencyMs ?? "?"} ms` : "injoignable";
              })()}
            </div>
          </div>
        )}
      </div>

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
              className={alive ? "brain-flow" : undefined}
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
                className="brain-node"
                style={{ animationDuration: `${duration}s` }}
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
