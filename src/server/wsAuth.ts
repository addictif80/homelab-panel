import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

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
