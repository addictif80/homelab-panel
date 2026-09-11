"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import ThemeToggle from "./ThemeToggle";

const NAV_SECTIONS: { label: string; items: { href: string; label: string }[] }[] = [
  { label: "", items: [{ href: "/", label: "Vue d'ensemble" }, { href: "/brain", label: "Vue vivante" }] },
  {
    label: "Infrastructure",
    items: [
      { href: "/servers", label: "Serveurs physiques" },
      { href: "/proxmox", label: "Serveurs VM" },
      { href: "/docker", label: "Docker" },
      { href: "/ssh", label: "Terminal SSH" },
      { href: "/updates", label: "Mises à jour" },
      { href: "/files", label: "Explorateur de fichiers" },
      { href: "/cyberpanel", label: "CyberPanel" },
    ],
  },
  {
    label: "Réseau",
    items: [
      { href: "/routers", label: "Box & routeurs" },
      { href: "/tailscale", label: "Tailscale" },
      { href: "/proxy", label: "Reverse proxy" },
      { href: "/dns", label: "DNS" },
      { href: "/uptime", label: "Uptime Kuma" },
      { href: "/discovery", label: "Découverte réseau" },
    ],
  },
  {
    label: "Protection",
    items: [
      { href: "/security", label: "Sécurité" },
      { href: "/backups", label: "Sauvegardes" },
    ],
  },
  {
    label: "Système",
    items: [
      { href: "/inventory", label: "Inventaire & topologie" },
      { href: "/audit", label: "Journal d'audit" },
      { href: "/users", label: "Comptes" },
    ],
  },
  ...(process.env.NEXT_PUBLIC_SELLER_MODE === "true"
    ? [{ label: "Vendeur", items: [{ href: "/seller", label: "Espace vendeur" }] }]
    : []),
];

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.6" className="text-blue-600" />
        <path d="M7.5 9H16.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="text-blue-600" />
        <path d="M7.5 12.5H16.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="text-blue-600" />
        <path d="M7.5 16H12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="text-blue-600" />
      </svg>
      <span className="font-display text-sm font-semibold tracking-wide text-neutral-100">Homelab Panel</span>
    </div>
  );
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-5 overflow-auto">
      {NAV_SECTIONS.map((section) => (
        <div key={section.label || "root"}>
          {section.label && (
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
              {section.label}
            </p>
          )}
          <div className="space-y-0.5">
            {section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={`block rounded-md px-3 py-2 text-sm transition-colors md:py-1.5 ${
                  pathname === item.href
                    ? "bg-blue-600/15 font-medium text-blue-300"
                    : "text-neutral-400 hover:bg-neutral-800/70 hover:text-neutral-200"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function PublicIps({ ips }: { ips: string[] }) {
  if (ips.length === 0) return null;
  return (
    <div className="mt-4 border-t border-neutral-800 pt-3">
      <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
        IP publique{ips.length > 1 ? "s" : ""}
      </p>
      <div className="space-y-0.5 px-3">
        {ips.map((ip) => (
          <p key={ip} className="font-mono text-xs text-neutral-400">
            {ip}
          </p>
        ))}
      </div>
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [publicIps, setPublicIps] = useState<string[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    fetch("/api/hosts")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.hosts) return;
        // Several physical machines can share one public IP (same ISP line/box) — dedupe so it's
        // a list of distinct exit points, not one row per host.
        const ips = (data.hosts as { public_ip: string | null }[])
          .map((h) => h.public_ip)
          .filter((ip): ip is string => !!ip);
        setPublicIps(Array.from(new Set(ips)));
      })
      .catch(() => {});
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
      <aside className="hidden w-60 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900 p-4 md:flex">
        <div className="mb-6 flex items-center justify-between px-1">
          <Logo />
          <ThemeToggle />
        </div>
        <NavLinks pathname={pathname} />
        <PublicIps ips={publicIps} />
        <button
          onClick={handleLogout}
          className="mt-4 rounded-md px-3 py-1.5 text-left text-sm text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
        >
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
          <NavLinks pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          <PublicIps ips={publicIps} />
          <button
            onClick={handleLogout}
            className="mt-4 rounded-md px-3 py-2 text-left text-sm text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
          >
            Déconnexion
          </button>
        </div>
      </div>
    </>
  );
}
