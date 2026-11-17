"use client";

import { useLayoutEffect, useState } from "react";

/**
 * The in-app launch splash — same intent as addictif80/familyboard's templates/layout.php: picks
 * up exactly where the native OS splash (apple-touch-startup-image / Android's generated one,
 * both driven by the same mark) leaves off, then fades into the real UI, with no visible seam.
 *
 * Unlike familyboard's plain PHP template, this app's HTML isn't literal static markup — Next's
 * App Router streams the body as an RSC payload that React reconstructs client-side, and a
 * React-inserted <script> tag never executes (the DOM spec only runs a <script> parsed directly
 * off the network stream, not one assigned via innerHTML/createElement). `useLayoutEffect` runs
 * synchronously right after React commits the DOM but strictly before the browser paints, so a
 * session that shouldn't see the splash at all (not installed standalone, already seen this
 * session, reduced-motion) has it gone before that first paint — no flash. Unmounting is done
 * through React state (not a raw `element.remove()`), since mutating a DOM node React still
 * thinks it owns throws a NotFoundError the next time React itself touches that subtree (route
 * change, dev-mode re-render...).
 *
 * Shown at most once per browser session (sessionStorage), and only when running "installed"
 * (display-mode: standalone / iOS's navigator.standalone) — never on an ordinary browser tab.
 */
export default function AppSplash() {
  const [show, setShow] = useState(true);
  const [fading, setFading] = useState(false);

  useLayoutEffect(() => {
    try {
      const standalone =
        (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
      const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const seen = sessionStorage.getItem("hlp-splash-shown");
      if (!standalone || reduced || seen) {
        setShow(false);
        return;
      }
      sessionStorage.setItem("hlp-splash-shown", "1");

      let removed = false;
      let hideTimer: ReturnType<typeof setTimeout>;
      const removeSplash = () => {
        if (removed) return;
        removed = true;
        setFading(true);
        hideTimer = setTimeout(() => setShow(false), 220);
      };
      const onLoad = () => setTimeout(removeSplash, 200);
      window.addEventListener("load", onLoad);
      const fallback = setTimeout(removeSplash, 1400);

      return () => {
        window.removeEventListener("load", onLoad);
        clearTimeout(fallback);
        clearTimeout(hideTimer);
      };
    } catch {
      setShow(false);
    }
  }, []);

  if (!show) return null;

  return (
    <div className={`app-splash${fading ? " fade-out" : ""}`} aria-hidden="true">
      <div className="app-splash-mark">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
          <defs>
            <linearGradient id="splashMarkGradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#6D5BFA" />
              <stop offset="100%" stopColor="#C026D3" />
            </linearGradient>
          </defs>
          <rect width="100" height="100" rx="22" fill="url(#splashMarkGradient)" />
          <g fill="#fff">
            <rect x="26" y="30" width="48" height="13" rx="4" fillOpacity=".95" />
            <rect x="26" y="46.5" width="48" height="13" rx="4" fillOpacity=".8" />
            <rect x="26" y="63" width="48" height="13" rx="4" fillOpacity=".65" />
            <circle cx="33" cy="36.5" r="2.6" fill="#1A1A2E" />
          </g>
          <circle cx="68" cy="36.5" r="5.5" fill="#34D399" stroke="#6D5BFA" strokeWidth="2" />
        </svg>
      </div>
      <div className="app-splash-word">Homelab Panel</div>
    </div>
  );
}
