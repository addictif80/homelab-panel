"use client";

type Host = { id: number; name: string; kind: string };
type Link = { id: number; host_a_id: number; host_b_id: number; link_type: string };

const LINK_STYLE: Record<string, { stroke: string; dash?: string }> = {
  lan: { stroke: "#525252" },
  tailscale: { stroke: "#60a5fa", dash: "4 3" },
  cluster: { stroke: "#4ade80" },
  network: { stroke: "#737373" },
};

const KIND_COLOR: Record<string, string> = {
  physical: "#f97316",
  vm: "#a78bfa",
  lxc: "#a78bfa",
  vps: "#38bdf8",
  nas: "#facc15",
  router: "#f472b6",
};

export default function TopologyDiagram({ hosts, links }: { hosts: Host[]; links: Link[] }) {
  const width = 720;
  const height = 520;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2 - 80;

  const positions = new Map<number, { x: number; y: number }>();
  hosts.forEach((h, i) => {
    const angle = (i / hosts.length) * 2 * Math.PI - Math.PI / 2;
    positions.set(h.id, {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  });

  return (
    <div className="rounded border border-neutral-800 bg-neutral-925 p-4">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ maxHeight: 560 }}>
        {links.map((l) => {
          const a = positions.get(l.host_a_id);
          const b = positions.get(l.host_b_id);
          if (!a || !b) return null;
          const style = LINK_STYLE[l.link_type] ?? LINK_STYLE.network;
          return (
            <line
              key={l.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={style.stroke}
              strokeWidth={1.5}
              strokeDasharray={style.dash}
              opacity={0.8}
            />
          );
        })}
        {hosts.map((h) => {
          const p = positions.get(h.id);
          if (!p) return null;
          const color = KIND_COLOR[h.kind] ?? "#a3a3a3";
          return (
            <g key={h.id} transform={`translate(${p.x}, ${p.y})`}>
              <circle r={10} fill={color} stroke="#171717" strokeWidth={2} />
              <text
                y={26}
                textAnchor="middle"
                fontSize={11}
                fill="#e5e5e5"
                style={{ userSelect: "none" }}
              >
                {h.name}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-neutral-400">
        <LegendDot color={LINK_STYLE.lan.stroke} label="Lien LAN" />
        <LegendDot color={LINK_STYLE.tailscale.stroke} label="Lien Tailscale" dashed />
        <LegendDot color={LINK_STYLE.cluster.stroke} label="Cluster Proxmox" />
      </div>
    </div>
  );
}

function LegendDot({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="inline-block h-0.5 w-5"
        style={{ backgroundColor: dashed ? "transparent" : color, borderTop: dashed ? `2px dashed ${color}` : undefined }}
      />
      {label}
    </div>
  );
}
