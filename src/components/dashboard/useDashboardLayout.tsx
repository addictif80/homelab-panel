"use client";

import { useEffect, useState, useRef } from "react";
import { DEFAULT_LAYOUT, type DashboardLayout } from "@/lib/dashboardWidgets";

/** Loads the signed-in user's saved widget layout (or DEFAULT_LAYOUT if they never customized
 * it) and auto-saves it (debounced) whenever it changes.
 *
 * Saving happens from a `useEffect` keyed on `layout` rather than from an explicit `persist()`
 * call next to each `setLayout()` — a drag handler that computes its new layout inside a
 * functional `setLayout(prev => next)` updater has no reliable way to also hand that `next` value
 * to a `persist()` call on the next line: React does not guarantee the updater runs before that
 * line executes (it can defer running it to the batched render), so a variable meant to capture
 * `next` for that purpose can still be unset when read. Deriving "save" from the state itself,
 * once it's actually committed, sidesteps that entirely — every caller just calls `setLayout`. */
export function useDashboardLayout() {
  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [loading, setLoading] = useState(true);
  const skipNextSave = useRef(true);

  useEffect(() => {
    fetch("/api/dashboard/layout")
      .then((r) => r.json())
      .then((d) => setLayout(d.layout ?? DEFAULT_LAYOUT))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!layout) return;
    // The load above also flows through this effect (setLayout in its .then) — skip that one so
    // a fresh page load doesn't immediately PUT back the exact layout it just GET'd.
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    const timer = setTimeout(() => {
      fetch("/api/dashboard/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout }),
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [layout]);

  return { layout, setLayout, loading };
}
