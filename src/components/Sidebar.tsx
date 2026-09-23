"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import ThemeToggle from "./ThemeToggle";

type IconName =
  | "grid"
  | "pulse"
  | "server-rack"
  | "heartbeat"
  | "vm"
  | "docker"
  | "database"
  | "terminal"
  | "rdp"
  | "files"
  | "clock"
  | "directory"
  | "cyberpanel"
  | "router"
  | "tailscale"
  | "proxy"
  | "dns"
  | "uptime"
  | "discovery"
  | "shield"
  | "mail"
  | "backup"
  | "topology"
  | "assistant"
  | "audit"
  | "users"
  | "settings"
  | "storefront"
  | "docs"
  | "incident"
  | "disaster"
  | "wrapped"
  | "missioncontrol"
  | "help";

const NAV_SECTIONS: { label: string; items: { href: string; label: string; icon: IconName }[] }[] = [
  {
    label: "",
    items: [
      { href: "/", label: "Vue d'ensemble", icon: "grid" },
      { href: "/brain", label: "Vue vivante", icon: "pulse" },
      { href: "/mission-control", label: "Mission Control", icon: "missioncontrol" },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      { href: "/servers", label: "Serveurs physiques", icon: "server-rack" },
      { href: "/hardware", label: "Santé matérielle", icon: "heartbeat" },
      { href: "/proxmox", label: "Serveurs VM", icon: "vm" },
      { href: "/docker", label: "Docker", icon: "docker" },
      { href: "/databases", label: "Bases de données", icon: "database" },
      { href: "/ssh", label: "Terminal SSH", icon: "terminal" },
      { href: "/rdp", label: "Client RDP", icon: "rdp" },
      { href: "/updates", label: "Mises à jour", icon: "clock" },
      { href: "/files", label: "Explorateur de fichiers", icon: "files" },
    ],
  },
  {
    label: "Services",
    items: [
      { href: "/services", label: "Services & annuaire", icon: "directory" },
      { href: "/cyberpanel", label: "CyberPanel", icon: "cyberpanel" },
    ],
  },
  {
    label: "Réseau",
    items: [
      { href: "/routers", label: "Box & routeurs", icon: "router" },
      { href: "/tailscale", label: "Tailscale", icon: "tailscale" },
      { href: "/proxy", label: "Reverse proxy", icon: "proxy" },
      { href: "/dns", label: "DNS", icon: "dns" },
      { href: "/uptime", label: "Uptime Kuma", icon: "uptime" },
      { href: "/discovery", label: "Découverte réseau", icon: "discovery" },
    ],
  },
  {
    label: "Sécurité",
    items: [
      { href: "/security", label: "Sécurité", icon: "shield" },
      { href: "/incidents", label: "Incidents", icon: "incident" },
      { href: "/disaster-simulator", label: "Simulateur de sinistre", icon: "disaster" },
      { href: "/mail-security", label: "Anti-spam mail", icon: "mail" },
      { href: "/backups", label: "Sauvegardes", icon: "backup" },
    ],
  },
  {
    label: "Système",
    items: [
      { href: "/inventory", label: "Inventaire & topologie", icon: "topology" },
      { href: "/architecture", label: "Documentation d'architecture", icon: "docs" },
      { href: "/wrapped", label: "Récap annuel", icon: "wrapped" },
      { href: "/assistant", label: "Assistant IA", icon: "assistant" },
      { href: "/audit", label: "Journal d'audit", icon: "audit" },
      { href: "/users", label: "Comptes", icon: "users" },
      { href: "/settings", label: "Réglages", icon: "settings" },
    ],
  },
  ...(process.env.NEXT_PUBLIC_SELLER_MODE === "true"
    ? [{ label: "Vendeur", items: [{ href: "/seller", label: "Espace vendeur", icon: "storefront" as IconName }] }]
    : []),
];

// Shown only to the account created by an emergency-access activation — everyone else already has
// the full nav above and doesn't need a "what is this and what do I do first" guide.
const HELP_SECTION = { label: "Aide", items: [{ href: "/help-urgence", label: "Accès d'urgence", icon: "help" as IconName }] };

// The env-gated section above is baked in at build time, but a /demo sandbox running on this same
// seller instance still needs it hidden per-request — filtered out here rather than in
// NAV_SECTIONS itself, based on the isDemo flag Sidebar() fetches from /api/auth/me. The actual
// access control lives server-side in proxy.ts; this only keeps the link from being shown at all.
function navSectionsFor(isDemo: boolean, isTrustedContact: boolean) {
  const sections = isDemo ? NAV_SECTIONS.filter((s) => s.label !== "Vendeur") : NAV_SECTIONS;
  return isTrustedContact ? [HELP_SECTION, ...sections] : sections;
}

function NavIcon({ name }: { name: IconName }) {
  const common = { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none" } as const;
  switch (name) {
    case "grid":
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
          <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
          <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
          <rect x="13" y="13" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case "pulse":
      return (
        <svg {...common}>
          <path d="M4 12h4l2-7 4 14 2-7h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "server-rack":
      return (
        <svg {...common}>
          <rect x="4" y="3.5" width="16" height="6" rx="1.3" stroke="currentColor" strokeWidth="1.6" />
          <rect x="4" y="14.5" width="16" height="6" rx="1.3" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case "heartbeat":
      return (
        <svg {...common}>
          <path d="M12 3v11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="12" cy="17" r="3" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case "vm":
      return (
        <svg {...common}>
          <rect x="2.5" y="8.5" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
          <rect x="14.5" y="8.5" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case "docker":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6" />
          <rect x="13" y="4" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6" />
          <rect x="8.5" y="13" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case "database":
      return (
        <svg {...common}>
          <ellipse cx="12" cy="6" rx="7" ry="2.3" stroke="currentColor" strokeWidth="1.6" />
          <path d="M5 6v11c0 1.3 3.1 2.3 7 2.3s7-1 7-2.3V6" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case "terminal":
      return (
        <svg {...common}>
          <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M7 9.5l3 2.5-3 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "files":
      return (
        <svg {...common}>
          <path d="M4 14.5l4-8 4 5 3-4 5 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case "rdp":
      return (
        <svg {...common}>
          <rect x="3" y="4.5" width="18" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M9 20h6M12 16.5V20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "docs":
      return (
        <svg {...common}>
          <path d="M6 3.5h9l4 4V19a1.3 1.3 0 01-1.3 1.3H6A1.3 1.3 0 014.7 19V4.8A1.3 1.3 0 016 3.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M8 10h8M8 13.5h8M8 17h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "incident":
      return (
        <svg {...common}>
          <path d="M12 3.5l9 16H3l9-16z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M12 10v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="12" cy="17" r="0.9" fill="currentColor" />
        </svg>
      );
    case "disaster":
      return (
        <svg {...common}>
          <path d="M12 4c-4 3-7 6.5-7 10.5A7 7 0 0012 21a7 7 0 007-6.5C19 10.5 16 7 12 4z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M12 9.5c-1.5 1.5-2.5 2.8-2.5 4a2.5 2.5 0 005 0c0-1.2-1-2.5-2.5-4z" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      );
    case "wrapped":
      return (
        <svg {...common}>
          <rect x="4" y="3.5" width="16" height="17" rx="2.3" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 8h8M8 12h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="9.5" cy="16" r="1.1" fill="currentColor" />
          <circle cx="13.5" cy="16" r="1.1" fill="currentColor" />
        </svg>
      );
    case "missioncontrol":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M7 20h10M12 16v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="8" cy="10" r="1" fill="currentColor" />
          <circle cx="12" cy="10" r="1" fill="currentColor" />
          <circle cx="16" cy="10" r="1" fill="currentColor" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "directory":
      return (
        <svg {...common}>
          <rect x="3.5" y="4.5" width="7.5" height="7.5" rx="1.3" stroke="currentColor" strokeWidth="1.6" />
          <rect x="13" y="4.5" width="7.5" height="7.5" rx="1.3" stroke="currentColor" strokeWidth="1.6" />
          <rect x="3.5" y="14" width="16" height="5.5" rx="1.3" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case "cyberpanel":
      return (
        <svg {...common}>
          <path d="M4 6l8-3 8 3v6c0 5-3.4 8.4-8 9.5-4.6-1.1-8-4.5-8-9.5V6z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      );
    case "router":
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="14" rx="1.6" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 19v2M16 19v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "tailscale":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="2.3" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 8a5.5 5.5 0 000 8M16 8a5.5 5.5 0 010 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "proxy":
      return (
        <svg {...common}>
          <circle cx="7" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="17" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case "dns":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M3.8 12h16.4M12 3.8c2.3 2.2 3.6 5.2 3.6 8.2s-1.3 6-3.6 8.2c-2.3-2.2-3.6-5.2-3.6-8.2S9.7 6 12 3.8z"
            stroke="currentColor"
            strokeWidth="1.6"
          />
        </svg>
      );
    case "uptime":
      return (
        <svg {...common}>
          <path d="M4 15l4-6 3 3 4-7 5 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "discovery":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M5.5 5.5a9.5 9.5 0 000 13M18.5 5.5a9.5 9.5 0 010 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3l7 3.2v5.4c0 4.7-3 8-7 9.4-4-1.4-7-4.7-7-9.4V6.2L12 3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      );
    case "mail":
      return (
        <svg {...common}>
          <rect x="3.5" y="5.5" width="17" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M4 7l8 6 8-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "backup":
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="4.2" rx="1" stroke="currentColor" strokeWidth="1.6" />
          <path d="M4.5 9.2V17a2 2 0 002 2h11a2 2 0 002-2V9.2" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case "topology":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2.3" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="18" cy="6" r="2.3" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="12" cy="18" r="2.3" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 7l7-.3M9 8l2.3 8.5M15 8l-2.3 8.5" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      );
    case "assistant":
      return (
        <svg {...common}>
          <rect x="5" y="4.5" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M9 20l3-3.5 3 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "audit":
      return (
        <svg {...common}>
          <path d="M6 4h9l5 5v11a1 1 0 01-1 1H6a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M8.5 12.5h7M8.5 15.5h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "users":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.6" />
          <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="17.5" cy="8.5" r="2.3" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M12 3v2.3M12 18.7V21M4.2 7.5l2 1.2M17.8 15.3l2 1.2M4.2 16.5l2-1.2M17.8 8.7l2-1.2"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      );
    case "help":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M9.5 9.2a2.5 2.5 0 014.8 1c0 1.6-2.3 1.8-2.3 3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="12" cy="17" r="1" fill="currentColor" />
        </svg>
      );
    case "storefront":
      return (
        <svg {...common}>
          <path d="M4 9l1-5h14l1 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 9a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M5 9.5V20h14V9.5" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
  }
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px]"
        style={{ backgroundImage: "var(--grad)", boxShadow: "0 4px 12px -3px rgba(109,91,250,0.55)" }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="8" height="8" rx="2" fill="white" fillOpacity="0.95" />
          <rect x="13" y="3" width="8" height="8" rx="2" fill="white" fillOpacity="0.65" />
          <rect x="3" y="13" width="8" height="8" rx="2" fill="white" fillOpacity="0.65" />
          <rect x="13" y="13" width="8" height="8" rx="2" fill="white" fillOpacity="0.95" />
        </svg>
      </div>
      <span className="font-display text-[15px] font-bold tracking-tight text-neutral-100">Homelab Panel</span>
    </div>
  );
}

function NavLinks({
  pathname,
  isDemo,
  isTrustedContact,
  onNavigate,
}: {
  pathname: string;
  isDemo: boolean;
  isTrustedContact: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 space-y-6 overflow-auto">
      {navSectionsFor(isDemo, isTrustedContact).map((section) => (
        <div key={section.label || "root"}>
          {section.label && (
            <p className="mb-1.5 px-2.5 text-[10.5px] font-bold uppercase tracking-wider text-neutral-600">
              {section.label}
            </p>
          )}
          <div className="space-y-0.5">
            {section.items.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={`flex items-center gap-2.5 rounded-[10px] px-2.5 py-[7.5px] text-[13.5px] transition-colors md:py-[7.5px] ${
                    active
                      ? "bg-blue-600/15 font-bold text-blue-300"
                      : "font-medium text-neutral-400 hover:bg-neutral-800/70 hover:text-neutral-200"
                  }`}
                >
                  <span
                    className="icon-chip h-6 w-6"
                    style={
                      active
                        ? { backgroundImage: "var(--grad)", color: "#fff" }
                        : { background: "var(--color-neutral-950)", color: "inherit" }
                    }
                  >
                    <NavIcon name={item.icon} />
                  </span>
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

type PublicIpEntry = { ip: string; owners: string[] };

function PublicIps({ entries }: { entries: PublicIpEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="mt-4 border-t border-neutral-800 pt-3">
      <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
        IP publique{entries.length > 1 ? "s" : ""}
      </p>
      <div className="space-y-1 px-3">
        {entries.map(({ ip, owners }) => (
          <p key={ip} className="font-mono text-xs text-neutral-400">
            {ip}
            {owners.length > 0 && <span className="text-neutral-600"> ({owners.join(", ")})</span>}
          </p>
        ))}
      </div>
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [publicIps, setPublicIps] = useState<PublicIpEntry[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [isTrustedContact, setIsTrustedContact] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        setIsDemo(!!d?.isDemo);
        setIsTrustedContact(!!d?.isTrustedContact);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/hosts")
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
      // Fallback for installs with no router configured under Box & routeurs: the IP the panel's
      // own traffic exits with, detected automatically rather than needing to be typed in anywhere.
      fetch("/api/network/public-ip")
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
    ]).then(([hostsData, panelIpData]) => {
      // Several machines can share one public IP (same ISP line/box) — group by IP so each row
      // names every owner instead of repeating the same address once per host.
      const owners = new Map<string, Set<string>>();
      const addOwner = (ip: string | null | undefined, name: string) => {
        if (!ip) return;
        const set = owners.get(ip) ?? new Set<string>();
        set.add(name);
        owners.set(ip, set);
      };
      (hostsData?.hosts as { name: string; public_ip: string | null }[] | undefined)?.forEach((h) =>
        addOwner(h.public_ip, h.name)
      );
      if (panelIpData?.ip) addOwner(panelIpData.ip, "Panel");
      setPublicIps(Array.from(owners.entries()).map(([ip, names]) => ({ ip, owners: Array.from(names) })));
    });
  }, []);

  // A route change is the normal way a drawer link gets used, so close it automatically instead
  // of relying only on the explicit onNavigate handler (also covers back/forward navigation).
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <>
      {/* Mobile top bar — replaces the always-visible desktop sidebar below md, since a fixed
          240px column has no room on a phone screen. */}
      <div
        className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900 px-3 py-2.5 md:hidden"
        style={{ paddingTop: "max(0.625rem, env(safe-area-inset-top))" }}
      >
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Ouvrir le menu"
          className="flex h-10 w-10 items-center justify-center rounded-md text-neutral-300 hover:bg-neutral-800"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <Logo />
        <ThemeToggle />
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden w-[260px] shrink-0 flex-col border-r border-neutral-800 bg-neutral-900 p-3.5 md:flex">
        <div className="mb-6 flex items-center justify-between px-1">
          <Logo />
          <ThemeToggle />
        </div>
        <NavLinks pathname={pathname} isDemo={isDemo} isTrustedContact={isTrustedContact} />
        <PublicIps entries={publicIps} />
        <button
          onClick={handleLogout}
          className="mt-4 flex items-center gap-2.5 rounded-[10px] px-2.5 py-[7.5px] text-left text-[13.5px] font-medium text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
        >
          <span className="icon-chip h-6 w-6" style={{ background: "var(--color-neutral-950)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          Déconnexion
        </button>
      </aside>

      {/* Mobile drawer — kept mounted at all times and animated via transform/opacity so both the
          open and close transitions are smooth, instead of the panel just popping in and out. */}
      <div className={`fixed inset-0 z-50 md:hidden ${mobileOpen ? "" : "pointer-events-none"}`}>
        <div
          className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${
            mobileOpen ? "opacity-100" : "opacity-0"
          }`}
          onClick={() => setMobileOpen(false)}
        />
        <div
          className={`absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-neutral-800 bg-neutral-900 p-4 shadow-xl transition-transform duration-200 ease-out ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
          style={{
            paddingTop: "max(1rem, env(safe-area-inset-top))",
            paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
          }}
        >
          <div className="mb-6 flex items-center justify-between px-1">
            <Logo />
            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Fermer le menu"
              className="flex h-9 w-9 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <NavLinks
            pathname={pathname}
            isDemo={isDemo}
            isTrustedContact={isTrustedContact}
            onNavigate={() => setMobileOpen(false)}
          />
          <PublicIps entries={publicIps} />
          <button
            onClick={handleLogout}
            className="mt-4 flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13.5px] font-medium text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
          >
            <span className="icon-chip h-6 w-6" style={{ background: "var(--color-neutral-950)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            Déconnexion
          </button>
        </div>
      </div>
    </>
  );
}
