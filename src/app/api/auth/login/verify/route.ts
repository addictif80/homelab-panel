import { NextRequest, NextResponse } from "next/server";
import {
  verifyPending2faToken,
  createSessionToken,
  getUserByUsername,
  clientIp,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE,
  isLockedOut,
  recordLoginAttempt,
} from "@/lib/auth";
import { decryptTotpSecret, verifyTotpCode } from "@/lib/totp";
import { createTrustedDevice, TRUSTED_DEVICE_COOKIE_NAME, TRUSTED_DEVICE_MAX_AGE } from "@/lib/trustedDevices";
import { logAudit } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const { pendingToken, code, trustDevice } = await req.json();

    const username = pendingToken ? await verifyPending2faToken(pendingToken) : null;
    if (!username) {
      return NextResponse.json({ error: "Session de connexion expirée." }, { status: 401 });
    }

    if (isLockedOut(ip, username)) {
      logAudit("login.locked_out", username, ip);
      return NextResponse.json(
        { error: "Trop de tentatives échouées. Réessaie dans 15 minutes." },
        { status: 429 }
      );
    }

    const user = getUserByUsername(username);
    if (!user || !user.totp_enabled || !user.totp_secret_encrypted) {
      return NextResponse.json({ error: "Compte invalide." }, { status: 401 });
    }

    const secret = decryptTotpSecret(user.totp_secret_encrypted);
    const valid = verifyTotpCode(secret, String(code || ""));
    recordLoginAttempt(ip, username, valid);

    if (!valid) {
      logAudit("login.2fa_failed", username, ip);
      return NextResponse.json({ error: "Code 2FA invalide." }, { status: 401 });
    }

    const sessionToken = await createSessionToken(username);
    logAudit("login.success", username, ip);

    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE,
      path: "/",
    });

    if (trustDevice) {
      const label = req.headers.get("user-agent")?.slice(0, 80);
      const trustToken = createTrustedDevice(username, label);
      res.cookies.set(TRUSTED_DEVICE_COOKIE_NAME, trustToken, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: TRUSTED_DEVICE_MAX_AGE,
        path: "/",
      });
    }

    return res;
  } catch (err) {
    console.error("POST /api/auth/login/verify failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur serveur inattendue." },
      { status: 500 }
    );
  }
}
