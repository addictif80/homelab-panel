import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

/**
 * WebSocket upgrades aren't covered by SameSite cookie rules the way a fetch/XHR is in every
 * browser (and cookie attributes are the only thing standing between a cross-site page and this
 * socket otherwise) — so this is checked as defense in depth before even looking at the cookie.
 * A browser always sets Origin on a cross-origin (and same-origin, in most browsers) WS handshake;
 * reject anything that doesn't match this server's own Host, rather than trusting SameSite alone
 * to keep a malicious page from opening a live SSH terminal or log-stream socket to this panel.
 */
export function isSameOriginUpgrade(headers: { origin?: string; host?: string }): boolean {
  if (!headers.origin) return false;
  try {
    return new URL(headers.origin).host === headers.host;
  } catch {
    return false;
  }
}

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** Verifies the session cookie on a WS upgrade request; returns the username, or null. */
export async function authenticateUpgrade(cookieHeader: string | undefined): Promise<string | null> {
  const token = parseCookie(cookieHeader, SESSION_COOKIE_NAME);
  return token ? verifySessionToken(token) : null;
}
