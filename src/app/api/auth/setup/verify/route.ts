import { NextRequest, NextResponse } from "next/server";
import { getDb, logAudit } from "@/lib/db";
import { getUserByUsername } from "@/lib/auth";
import { decryptTotpSecret, verifyTotpCode } from "@/lib/totp";

export async function POST(req: NextRequest) {
  try {
    const { username, code } = await req.json();
    const user = getUserByUsername(username);
    if (!user || !user.totp_secret_encrypted) {
      return NextResponse.json({ error: "Compte introuvable." }, { status: 404 });
    }
    if (user.totp_enabled) {
      return NextResponse.json({ error: "2FA déjà activée." }, { status: 409 });
    }

    const secret = decryptTotpSecret(user.totp_secret_encrypted);
    if (!verifyTotpCode(secret, String(code || ""))) {
      return NextResponse.json({ error: "Code invalide." }, { status: 401 });
    }

    getDb().prepare(`UPDATE users SET totp_enabled = 1 WHERE id = ?`).run(user.id);
    logAudit("account.2fa_enabled", username);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/auth/setup/verify failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur serveur inattendue." },
      { status: 500 }
    );
  }
}
