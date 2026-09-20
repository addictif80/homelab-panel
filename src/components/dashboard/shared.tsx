export const CHIP_COLORS: Record<string, { bg: string; fg: string }> = {
  accent: { bg: "color-mix(in srgb, var(--color-blue-600) 12%, transparent)", fg: "var(--color-blue-600)" },
  success: { bg: "color-mix(in srgb, var(--color-emerald-300) 12%, transparent)", fg: "var(--color-emerald-300)" },
  warning: { bg: "color-mix(in srgb, var(--color-amber-300) 12%, transparent)", fg: "var(--color-amber-300)" },
  danger: { bg: "color-mix(in srgb, var(--color-red-500) 12%, transparent)", fg: "var(--color-red-500)" },
  accent2: { bg: "color-mix(in srgb, var(--accent-2) 12%, transparent)", fg: "var(--accent-2)" },
};

export const AVATAR_GRADIENTS = [
  "linear-gradient(135deg,#6d5bfa,#8b7bff)",
  "linear-gradient(135deg,#0f9d58,#34d399)",
  "linear-gradient(135deg,#b7791f,#f0b429)",
  "linear-gradient(135deg,#c026d3,#e879f9)",
];

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function formatGb(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)} Go`;
}

export function StatCard({
  label,
  value,
  sub,
  color,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  color: keyof typeof CHIP_COLORS;
  icon: React.ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-neutral-500">{label}</span>
        <span className="icon-chip h-[30px] w-[30px]" style={{ background: CHIP_COLORS[color].bg, color: CHIP_COLORS[color].fg }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            {icon}
          </svg>
        </span>
      </div>
      <div className="text-2xl font-bold tracking-tight tabular-nums">{value}</div>
      <div className="mt-1.5 text-xs font-medium text-neutral-500">{sub}</div>
    </div>
  );
}

/** Compact "N / total" summary tile used by most small overview widgets — a title, a big number,
 * a subtitle, and an optional link to the full page for detail. */
export function MiniStat({
  value,
  label,
  href,
  hrefLabel,
  tone = "neutral",
}: {
  value: string;
  label: string;
  href?: string;
  hrefLabel?: string;
  tone?: "neutral" | "warning" | "danger" | "success";
}) {
  const toneClass =
    tone === "warning"
      ? "text-amber-400"
      : tone === "danger"
        ? "text-red-400"
        : tone === "success"
          ? "text-emerald-400"
          : "text-neutral-100";
  return (
    <div className="flex h-full flex-col justify-between">
      <div>
        <div className={`text-2xl font-bold tracking-tight tabular-nums ${toneClass}`}>{value}</div>
        <div className="mt-1 text-xs text-neutral-500">{label}</div>
      </div>
      {href && (
        <a href={href} className="mt-3 text-xs text-blue-600 hover:underline">
          {hrefLabel ?? "Voir plus →"}
        </a>
      )}
    </div>
  );
}

export function WidgetLoading() {
  return <p className="text-xs text-neutral-500">Chargement…</p>;
}

export function WidgetError({ message }: { message: string }) {
  return <p className="text-xs text-red-400">{message}</p>;
}
