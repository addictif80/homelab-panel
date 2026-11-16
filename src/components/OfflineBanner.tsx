"use client";

import { useEffect, useState } from "react";

/**
 * This panel needs a live connection to be useful at all (every page talks to the server over
 * SSH/APIs) — so unlike a typical PWA, there's no real offline mode to fall back to. What matters
 * on mobile is just not leaving the user guessing why nothing is loading: a thin banner the
 * instant the device itself goes offline, gone the instant it's back. Mirrors the same banner in
 * addictif80/familyboard's layout (#offline-banner).
 */
export default function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    setOffline(!navigator.onLine);
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="flex items-center justify-center gap-2 bg-amber-900/80 px-3 py-1.5 text-center text-xs font-medium text-amber-100">
      📴 Hors connexion — en attente du réseau...
    </div>
  );
}
