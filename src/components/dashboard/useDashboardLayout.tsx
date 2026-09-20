"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_LAYOUT, type DashboardLayout } from "@/lib/dashboardWidgets";

/** Loads the signed-in user's saved widget layout (or DEFAULT_LAYOUT if they never customized
 * it) and exposes a debounced save so drags/resizes don't fire a PUT per pixel. */
export function useDashboardLayout() {
  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [loading, setLoading] = useState(true);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/dashboard/layout")
      .then((r) => r.json())
      .then((d) => setLayout(d.layout ?? DEFAULT_LAYOUT))
      .finally(() => setLoading(false));
  }, []);

  const persist = useCallback((next: DashboardLayout) => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      fetch("/api/dashboard/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout: next }),
      });
    }, 400);
  }, []);

  return { layout, setLayout, persist, loading };
}
