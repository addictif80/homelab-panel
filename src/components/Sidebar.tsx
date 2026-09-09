"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Vue d'ensemble" },
  { href: "/security", label: "Sécurité" },
  { href: "/servers", label: "Serveurs physiques" },
  { href: "/proxmox", label: "Serveurs VM" },
  { href: "/docker", label: "Docker" },
  { href: "/ssh", label: "Terminal SSH" },
  { href: "/updates", label: "Mises à jour" },
  { href: "/backups", label: "Sauvegardes" },
  { href: "/files", label: "Explorateur de fichiers" },
  { href: "/tailscale", label: "Tailscale" },
  { href: "/proxy", label: "Reverse proxy" },
  { href: "/uptime", label: "Uptime Kuma" },
  { href: "/inventory", label: "Inventaire & topologie" },
  { href: "/audit", label: "Journal d'audit" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-6 text-sm font-semibold tracking-wide text-neutral-300">
        Homelab Panel
      </div>
      <nav className="flex-1 space-y-1">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`block rounded px-3 py-2 text-sm ${
              pathname === item.href
                ? "bg-blue-600/20 text-blue-300"
                : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <button
        onClick={handleLogout}
        className="mt-4 rounded px-3 py-2 text-left text-sm text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200"
      >
        Déconnexion
      </button>
    </aside>
  );
}
