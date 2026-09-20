import { CHIP_COLORS } from "../shared";

const MODULES = [
  { name: "Serveurs physiques", href: "/servers", color: "accent" as const },
  { name: "Serveurs VM", href: "/proxmox", color: "success" as const },
  { name: "Docker", href: "/docker", color: "accent2" as const },
  { name: "Terminal SSH", href: "/ssh", color: "warning" as const },
  { name: "Mises à jour", href: "/updates", color: "accent" as const },
  { name: "Explorateur de fichiers", href: "/files", color: "success" as const },
  { name: "Tailscale", href: "/tailscale", color: "accent2" as const },
  { name: "Inventaire & topologie", href: "/inventory", color: "warning" as const },
];

const MODULE_ICON: Record<string, React.ReactNode> = {
  "Serveurs physiques": (
    <>
      <rect x="4" y="3.5" width="16" height="6" rx="1.3" stroke="currentColor" strokeWidth="1.8" />
      <rect x="4" y="14.5" width="16" height="6" rx="1.3" stroke="currentColor" strokeWidth="1.8" />
    </>
  ),
  "Serveurs VM": (
    <>
      <rect x="2.5" y="8.5" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14.5" y="8.5" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.8" />
    </>
  ),
  Docker: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13" y="4" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.8" />
      <rect x="8.5" y="13" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.8" />
    </>
  ),
  "Terminal SSH": (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 9.5l3 2.5-3 2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  "Mises à jour": (
    <>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  "Explorateur de fichiers": (
    <>
      <path d="M4 14.5l4-8 4 5 3-4 5 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
    </>
  ),
  Tailscale: (
    <>
      <circle cx="12" cy="12" r="2.3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 8a5.5 5.5 0 000 8M16 8a5.5 5.5 0 010 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  "Inventaire & topologie": (
    <>
      <circle cx="6" cy="6" r="2.3" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="18" cy="6" r="2.3" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="18" r="2.3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 7l7-.3M9 8l2.3 8.5M15 8l-2.3 8.5" stroke="currentColor" strokeWidth="1.4" />
    </>
  ),
};

export function QuickAccessWidget() {
  return (
    <div className="grid grid-cols-2 gap-3 @sm:grid-cols-4">
      {MODULES.map((m) => (
        <a
          key={m.href}
          href={m.href}
          className="card flex flex-col gap-2.5 p-3.5 transition-transform hover:-translate-y-0.5 hover:border-neutral-700"
        >
          <span className="icon-chip h-8 w-8" style={{ background: CHIP_COLORS[m.color].bg, color: CHIP_COLORS[m.color].fg }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              {MODULE_ICON[m.name]}
            </svg>
          </span>
          <span className="text-[13px] font-semibold">{m.name}</span>
        </a>
      ))}
    </div>
  );
}
