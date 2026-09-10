"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const NAV_SECTIONS: { label: string; items: { href: string; label: string }[] }[] = [
  { label: "", items: [{ href: "/", label: "Vue d'ensemble" }] },
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
    ],
  },
  ...(process.env.NEXT_PUBLIC_SELLER_MODE === "true"
    ? [{ label: "Vendeur", items: [{ href: "/seller", label: "Espace vendeur" }] }]
    : []),
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-6 flex items-center gap-2 px-1">
        <span className="text-base">🏠</span>
        <span className="text-sm font-semibold tracking-wide text-neutral-100">Homelab Panel</span>
      </div>
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
                  className={`block rounded-md px-3 py-1.5 text-sm transition-colors ${
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
      <button
        onClick={handleLogout}
        className="mt-4 rounded-md px-3 py-1.5 text-left text-sm text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
      >
        Déconnexion
      </button>
    </aside>
  );
}
