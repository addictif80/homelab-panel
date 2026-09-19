import { NextRequest, NextResponse } from "next/server";
import { createDemoSession } from "@/lib/demo/store";
import { DEMO_COOKIE_NAME, DEMO_SESSION_MAX_AGE_SECONDS } from "@/lib/demo/context";
import { resolvePublicUrl } from "@/lib/seller/publicUrl";

/**
 * Public entry point for the sales demo (seller's own instance only — see SELLER_MODE check
 * below, and this whole directory is excluded from every customer export in exportBuild.ts).
 * Creates a fresh, isolated sandbox (in-memory DB, seeded with fictitious data — see
 * lib/demo/seedDemo.ts) and sends the visitor to the real login page to sign in with demo/demo,
 * same as any other account, just against that sandbox instead of the real database.
 */
export async function GET(req: NextRequest) {
  if (process.env.SELLER_MODE !== "true") {
    return NextResponse.json({ error: "Introuvable." }, { status: 404 });
  }

  const demoId = createDemoSession();
  // req.nextUrl.origin reflects whatever Host header reached this process — behind a reverse
  // proxy that doesn't forward it correctly, that can silently be the app's own bind address
  // (e.g. https://0.0.0.0:3001) instead of the real public domain. resolvePublicUrl falls back to
  // it but prefers the seller's explicitly configured public URL, same as every other route that
  // builds an absolute link a visitor's browser has to actually follow (see lib/seller/publicUrl.ts).
  const res = NextResponse.redirect(new URL("/login?demo=1", resolvePublicUrl(req.nextUrl.origin)));
  res.cookies.set(DEMO_COOKIE_NAME, demoId, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: DEMO_SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
  return res;
}
