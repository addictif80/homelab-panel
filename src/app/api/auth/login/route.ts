import { NextRequest, NextResponse } from "next/server";
import {
  getUserByUsername,
  verifyPassword,
  isLockedOut,
  recordLoginAttempt,
  createPending2faToken,
} from "@/lib/auth";
import { logAudit } from "@/lib/db";

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(req: NextRequest) {
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

  const pendingToken = await createPending2faToken(username);
  return NextResponse.json({ pendingToken });
}
