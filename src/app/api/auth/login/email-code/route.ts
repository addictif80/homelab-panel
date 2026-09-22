import { NextRequest, NextResponse } from "next/server";
import { verifyPending2faToken, getUserByUsername, clientIp, isLockedOut } from "@/lib/auth";
import { sendEmailLoginCode, EmailCodeCooldownError } from "@/lib/emailTwoFactor";
import { logAudit } from "@/lib/db";

/** Sends the email-delivered 2FA code — only reachable with a valid pending-2FA token, i.e. after
 * the password step already succeeded, so this can't be used to spam an arbitrary address. */
export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const { pendingToken } = await req.json();

    const username = pendingToken ? await verifyPending2faToken(pendingToken) : null;
    if (!username) {
      return NextResponse.json({ error: "Session de connexion expirée." }, { status: 401 });
    }

    if (isLockedOut(ip, username)) {
      return NextResponse.json(
        { error: "Trop de tentatives échouées. Réessaie dans 15 minutes." },
        { status: 429 }
      );
    }

    const user = getUserByUsername(username);
    if (!user) return NextResponse.json({ error: "Compte invalide." }, { status: 401 });
    if (!user.email) {
      return NextResponse.json(
        { error: "Aucune adresse email enregistrée pour ce compte. Demande à un administrateur de l'ajouter dans Comptes." },
        { status: 400 }
      );
    }

    try {
      await sendEmailLoginCode(username, user.email);
    } catch (err) {
      if (err instanceof EmailCodeCooldownError) {
        return NextResponse.json({ error: err.message }, { status: 429 });
      }
      throw err;
    }

    logAudit("login.email_code_sent", username, ip);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/auth/login/email-code failed:", err);
    // Errors thrown here are already user-safe, controlled French messages (SMTP not configured,
    // notifications disabled...) — never a raw exception, so relaying err.message is fine.
    const message = err instanceof Error ? err.message : "Impossible d'envoyer le code par email pour le moment.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
