import { NextRequest, NextResponse } from "next/server";
import {
  getUserByUsername,
  verifyPassword,
  isLockedOut,
  recordLoginAttempt,
  createPending2faToken,
  createSessionToken,
  clientIp,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE,
} from "@/lib/auth";
import { isTrustedDevice, TRUSTED_DEVICE_COOKIE_NAME } from "@/lib/trustedDevices";
import { logAudit } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json({ error: "Identifiants requis." }, { status: 400 });
    }

    if (isLockedOut(ip, username)) {
      logAudit("login.locked_out", username, ip);
      return NextResponse.json(
        { error: "Trop de tentatives échouées. Réessaie dans 15 minutes." },
        { status: 429 }
      );
    }

    const user = getUserByUsername(username);
    const valid = user ? verifyPassword(password, user.password_hash) : false;

    recordLoginAttempt(ip, username, valid);

    if (!user || !valid) {
      logAudit("login.failed", username, ip);
      return NextResponse.json({ error: "Identifiants invalides." }, { status: 401 });
    }

    if (!user.totp_enabled) {
      return NextResponse.json(
        { error: "La 2FA n'est pas encore configurée pour ce compte." },
        { status: 403 }
      );
    }

    const trustedToken = req.cookies.get(TRUSTED_DEVICE_COOKIE_NAME)?.value;
    if (isTrustedDevice(username, trustedToken)) {
      const sessionToken = await createSessionToken(username);
      logAudit("login.success_trusted_device", username, ip);
      const res = NextResponse.json({ ok: true, trustedDevice: true });
      res.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: SESSION_MAX_AGE,
        path: "/",
      });
      return res;
    }

    const pendingToken = await createPending2faToken(username);
    return NextResponse.json({ pendingToken });
  } catch (err) {
    console.error("POST /api/auth/login failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur serveur inattendue." },
      { status: 500 }
    );
  }
}
