import { NextResponse } from "next/server";
import { getSale } from "@/lib/seller/sales";
import { createDownloadToken } from "@/lib/seller/downloadTokens";
import { sendMail } from "@/lib/mail";
import { logAudit } from "@/lib/db";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sale = getSale(id);
  if (!sale) return NextResponse.json({ error: "Vente introuvable." }, { status: 404 });

  const token = createDownloadToken(sale.id);
  const origin = new URL(req.url).origin;
  const downloadUrl = `${origin}/api/download/${token}`;

  try {
    await sendMail(
      "Ton lien de téléchargement — Homelab Panel",
      `Voici un nouveau lien de téléchargement (à usage unique, valable 7 jours) :\n${downloadUrl}`,
      sale.customerEmail
    );
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Échec de l'envoi." }, { status: 502 });
  }

  logAudit("seller.download_resent", sale.id, sale.customerEmail);
  return NextResponse.json({ ok: true });
}
