"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Installability is a nice-to-have, not a requirement — a failed registration (e.g. no
        // HTTPS in dev) shouldn't surface as an error to the user.
      });
    }
  }, []);

  return null;
}
