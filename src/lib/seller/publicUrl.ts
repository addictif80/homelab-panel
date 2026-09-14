import { getSetting, setSetting } from "../db";

const SETTING_KEY = "seller_public_url";

export function getPanelPublicUrl(): string {
  return getSetting(SETTING_KEY) ?? "";
}

export function setPanelPublicUrl(url: string): void {
  setSetting(SETTING_KEY, url.trim().replace(/\/+$/, ""));
}

/**
 * A request's own origin (`req.nextUrl.origin`) reflects whatever Host header reached the
 * Next.js process — behind a reverse proxy that doesn't forward it correctly, that can silently
 * be the app's own bind address (e.g. `http://0.0.0.0:3001`) instead of the real public domain.
 * That's harmless for most routes, but every URL built from it here ends up somewhere it can't
 * be silently wrong: pasted into Stripe's webhook config, emailed to a paying customer as their
 * download link, or baked into every sold copy as the address it reports back to. Once the seller
 * sets a public URL explicitly, it always wins over the request-derived guess.
 */
export function resolvePublicUrl(fallbackOrigin: string): string {
  return getPanelPublicUrl() || fallbackOrigin;
}
