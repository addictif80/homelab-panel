"use client";

import { useEffect, useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";

type PublicLink = {
  id: string;
  name: string;
  url: string;
  description: string;
  faviconDataUrl: string | null;
  screenshotDataUrl: string | null;
};

function hostLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function FaviconOrInitial({ link }: { link: PublicLink }) {
  if (link.faviconDataUrl) {
    return <img src={link.faviconDataUrl} alt="" className="h-10 w-10 rounded-lg" />;
  }
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600/20 text-base font-semibold text-blue-300">
      {link.name.charAt(0).toUpperCase() || "?"}
    </div>
  );
}

export default function BoardPage() {
  const [links, setLinks] = useState<PublicLink[] | null>(null);

  useEffect(() => {
    fetch("/api/public/services")
      .then((r) => r.json())
      .then((d) => setLinks(d.links));
  }, []);

  function visit(link: PublicLink) {
    fetch(`/api/public/services/${link.id}/click`, { method: "POST" }).catch(() => {});
    window.open(link.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <nav className="border-b border-neutral-800 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.6" className="text-blue-600" />
              <path d="M7.5 9H16.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="text-blue-600" />
              <path d="M7.5 12.5H16.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="text-blue-600" />
              <path d="M7.5 16H12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="text-blue-600" />
            </svg>
            <span className="font-display text-base font-semibold">Services</span>
          </div>
          <ThemeToggle />
        </div>
      </nav>

      <main className="mx-auto max-w-5xl px-6 py-16">
        <div className="mb-12 text-center">
          <h1 className="text-3xl font-semibold">Nos services</h1>
          <p className="mt-3 text-neutral-400">Accès direct aux services disponibles.</p>
        </div>

        {links === null && <p className="text-center text-sm text-neutral-500">Chargement...</p>}

        {links !== null && links.length === 0 && (
          <p className="text-center text-sm text-neutral-500">Aucun service publié pour l&apos;instant.</p>
        )}

        {links !== null && links.length > 0 && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {links.map((link) => (
              <div
                key={link.id}
                className="flex flex-col justify-between overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 transition-colors hover:border-neutral-700"
              >
                {link.screenshotDataUrl && (
                  <img src={link.screenshotDataUrl} alt="" className="h-40 w-full border-b border-neutral-800 object-cover object-top" />
                )}
                <div className="flex flex-1 flex-col justify-between p-6">
                  <div>
                    <div className="flex items-center gap-3.5">
                      <FaviconOrInitial link={link} />
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold text-neutral-100">{link.name}</p>
                        <p className="truncate text-xs text-neutral-500">{hostLabel(link.url)}</p>
                      </div>
                    </div>
                    {link.description && (
                      <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-neutral-400">{link.description}</p>
                    )}
                  </div>
                  <button onClick={() => visit(link)} className="btn-primary mt-6 w-full py-2.5 text-sm">
                    Accéder
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
