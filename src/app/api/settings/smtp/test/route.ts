import { NextResponse } from "next/server";
import { sendMail } from "@/lib/mail";

export async function POST() {
  try {
    await sendMail(
      "[Homelab Panel] Email de test",
      "Si tu reçois cet email, la configuration SMTP du Homelab Panel fonctionne correctement."
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Échec de l'envoi." }, { status: 400 });
  }
}
