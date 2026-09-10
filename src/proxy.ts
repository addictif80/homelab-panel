import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, getUserRole, SESSION_COOKIE_NAME } from "@/lib/auth";
import { isMutationBlocked } from "@/lib/license";

const PUBLIC_PATHS = ["/login", "/setup"];
const PUBLIC_PATH_PREFIXES = ["/store"];
const PUBLIC_API_PREFIXES = ["/api/auth/", "/api/store/", "/api/download/"];
// Carved out of the otherwise auth-gated /api/seller/ prefix: every buyer's own self-hosted
// instance calls this one endpoint from the outside to activate, with no session of ours.
const PUBLIC_API_EXACT = [
  "/api/seller/license/validate",
  "/api/seller/releases/latest",
  "/api/seller/releases/download",
];
// Always reachable regardless of trial state — activating (or just checking status) can't
// itself be blocked by the thing it's meant to unblock.
const LICENSE_API_PREFIX = "/api/license/";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p)) ||
    PUBLIC_API_EXACT.includes(pathname) ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const username = token ? await verifySessionToken(token) : null;

  if (!username) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  if (
    pathname.startsWith("/api/") &&
    !pathname.startsWith(LICENSE_API_PREFIX) &&
    !SAFE_METHODS.has(req.method) &&
    isMutationBlocked()
  ) {
    return NextResponse.json(
      { error: "Essai expiré : cette action est désactivée tant que le panel n'est pas activé.", trialExpired: true },
      { status: 403 }
    );
  }

  // Viewer accounts get read-only access to every API route — including their own logout/session
  // endpoints, which are GET/POST-safe or explicitly excluded above already.
  if (pathname.startsWith("/api/") && !SAFE_METHODS.has(req.method) && getUserRole(username) === "viewer") {
    return NextResponse.json({ error: "Compte en lecture seule : action non autorisée." }, { status: 403 });
  }

  const res = NextResponse.next();
  res.headers.set("x-panel-user", username);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
