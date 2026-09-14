import { NextRequest, NextResponse } from "next/server";
import { activateLockdown } from "@/lib/lockdown";
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE } from "@/lib/auth";

/**
 * Requires the exact confirmation phrase in the body — this is the highest blast-radius button
 * in the panel (revokes every other session/device at once), so it must never fire from a
 * mis-click.
 *
 * proxy.ts's sliding-session refresh signs a fresh cookie for *every* authenticated request, but
 * it does so in middleware, before this route handler ever runs — so the cookie it attaches to
 * this very response is still stamped with the *old* session epoch, from before activateLockdown()
 * bumps it. Left alone, that stale refresh would lock the admin out of their own lockdown one
 * request later. Re-signing the cookie here, after the bump, with the new epoch baked in,
 * overrides that stale one in the response actually sent to the browser.
 */
export async function POST(req: NextRequest) {
  const { confirm } = (await req.json().catch(() => ({}))) as { confirm?: string };
  if (confirm !== "LOCKDOWN") {
    return NextResponse.json({ error: "Confirmation invalide." }, { status: 400 });
  }
  const result = await activateLockdown();

  const username = req.headers.get("x-panel-user");
  const res = NextResponse.json(result);
  if (username) {
    const freshToken = await createSessionToken(username);
    res.cookies.set(SESSION_COOKIE_NAME, freshToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE,
      path: "/",
    });
  }
  return res;
}
