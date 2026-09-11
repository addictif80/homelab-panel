import type { NextConfig } from "next";

// This panel has zero third-party script/style/font dependencies (fonts are self-hosted via
// next/font, Stripe checkout is a server-side redirect, not embedded Stripe.js) — so the CSP can
// stay tight. 'unsafe-inline' is still needed for script-src (ThemeInit's blocking dark/light
// script) and style-src (a few inline safe-area style props), not for third-party code.
// frame-src stays open since the Uptime Kuma panel embeds whatever URL the admin configures,
// which can be anywhere on their LAN; frame-ancestors is the actual clickjacking fix — nothing
// may embed this panel.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' ws: wss:",
  "frame-src 'self' http: https:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Session/trusted-device cookies are already Secure-only (browsers won't even store them over
  // plain HTTP), so this adds no new deployment constraint — moderate max-age, no `preload`,
  // since that list is effectively irreversible and this isn't a public multi-tenant service.
  { key: "Strict-Transport-Security", value: "max-age=15552000" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  /* config options here */
  serverExternalPackages: ["better-sqlite3", "ssh2", "dockerode"],
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
