"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const LOGOMARK = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="shrink-0">
    <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.6" className="text-blue-600" />
    <path d="M7.5 9H16.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="text-blue-600" />
    <path d="M7.5 12.5H16.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="text-blue-600" />
    <path d="M7.5 16H12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="text-blue-600" />
  </svg>
);

type DirectoryEntry = {
  id: string;
  ownerName: string;
  serviceName: string;
  serviceUrl: string;
  description: string;
  faviconDataUrl: string | null;
  screenshotDataUrl: string | null;
};

export default function DirectoryPage() {
  const [entries, setEntries] = useState<DirectoryEntry[] | null>(null);

  useEffect(() => {
    fetch("/api/store/directory")
      .then((r) => r.json())
      .then((d) => setEntries(d.entries ?? []))
      .catch(() => setEntries([]));
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <nav className="sticky top-0 z-20 border-b border-neutral-800 bg-neutral-950/90 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6">
          <Link href="/store" className="flex items-center gap-2.5">
            {LOGOMARK}
            <span className="font-display text-base font-semibold">Homelab Panel</span>
          </Link>
          <Link href="/store" className="text-sm text-neutral-400 hover:text-neutral-100">
            ← Retour à la page de vente
          </Link>
        </div>
      </nav>

      <header className="border-b border-neutral-800 py-14">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <span className="font-mono text-xs uppercase tracking-wider text-blue-400">Annuaire</span>
          <h1 className="mt-3 text-3xl font-semibold">Des services hébergés par nos clients</h1>
          <p className="mx-auto mt-3 max-w-xl text-neutral-400">
            Voici des services proposés par les utilisateurs de Homelab Panel, hébergés sur leur propre
            infrastructure. Chaque instance choisit elle-même ce qu&apos;elle publie ici, validé au cas par cas
            avant mise en ligne.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-14">
        {entries === null ? (
          <p className="text-center text-sm text-neutral-500">Chargement de l&apos;annuaire...</p>
        ) : entries.length === 0 ? (
          <p className="text-center text-sm text-neutral-500">
            Aucun service publié pour l&apos;instant — reviens bientôt.
          </p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {entries.map((entry) => (
              <a
                key={entry.id}
                href={entry.serviceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-gradient-to-b from-neutral-900 to-neutral-950 shadow-xl shadow-black/20 transition-transform hover:-translate-y-0.5"
              >
                {entry.screenshotDataUrl && (
                  <img src={entry.screenshotDataUrl} alt="" className="h-36 w-full border-b border-neutral-800 object-cover object-top" />
                )}
                <div className="flex items-center gap-3.5 p-5">
                  {entry.faviconDataUrl ? (
                    <img src={entry.faviconDataUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg" />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600/20 text-base font-semibold text-blue-300">
                      {entry.serviceName.charAt(0).toUpperCase() || "?"}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-neutral-100">{entry.serviceName}</p>
                    <p className="truncate text-xs text-neutral-500">{entry.ownerName}</p>
                    {entry.description && (
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-neutral-400">{entry.description}</p>
                    )}
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-neutral-800 py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 text-sm text-neutral-500">
          <span>Homelab Panel</span>
          <Link href="/store#support" className="hover:text-neutral-300">
            Besoin d&apos;aide ?
          </Link>
        </div>
      </footer>
    </div>
  );
}
