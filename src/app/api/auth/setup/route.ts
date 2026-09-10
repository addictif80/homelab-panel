import { NextRequest, NextResponse } from "next/server";
import { getDb, logAudit } from "@/lib/db";
import { hashPassword, getUserByUsername } from "@/lib/auth";
import { generateTotpSecret, encryptTotpSecret, buildOtpAuthQrDataUrl } from "@/lib/totp";

// This bootstraps the very first account, which always becomes admin — extra accounts are
// created afterwards from the admin's own /users page, not through this endpoint.
export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const existing = db.prepare(`SELECT COUNT(*) as c FROM users`).get() as { c: number };
    if (existing.c > 0) {
      return NextResponse.json({ error: "Un compte existe déjà." }, { status: 409 });
    }

    const { username, password } = await req.json();
    if (!username || typeof username !== "string" || username.length < 3) {
      return NextResponse.json({ error: "Nom d'utilisateur invalide." }, { status: 400 });
    }
    if (!password || typeof password !== "string" || password.length < 12) {
      return NextResponse.json(
        { error: "Le mot de passe doit contenir au moins 12 caractères." },
        { status: 400 }
      );
    }
    if (getUserByUsername(username)) {
      return NextResponse.json({ error: "Un compte existe déjà." }, { status: 409 });
    }

    const totpSecret = generateTotpSecret();
    const passwordHash = hashPassword(password);

    db.prepare(
      `INSERT INTO users (username, password_hash, totp_secret_encrypted, totp_enabled, role) VALUES (?, ?, ?, 0, 'admin')`
    ).run(username, passwordHash, encryptTotpSecret(totpSecret));

    const qrDataUrl = await buildOtpAuthQrDataUrl(username, totpSecret);
    logAudit("account.created", username);

    return NextResponse.json({ qrDataUrl, secret: totpSecret });
  } catch (err) {
    console.error("POST /api/auth/setup failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur serveur inattendue." },
      { status: 500 }
    );
  }
}
