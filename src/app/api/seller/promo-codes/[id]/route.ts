import { NextRequest, NextResponse } from "next/server";
import { setPromoCodeEnabled, deletePromoCode } from "@/lib/seller/promoCodes";
import { logAudit } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { enabled } = (await req.json().catch(() => ({}))) as { enabled?: boolean };
  if (typeof enabled !== "boolean") return NextResponse.json({ error: "Champ 'enabled' requis." }, { status: 400 });

  try {
    await setPromoCodeEnabled(id, enabled);
    logAudit("seller.promo_code_toggled", id, enabled ? "activé" : "désactivé");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deletePromoCode(id);
  logAudit("seller.promo_code_deleted", id);
  return NextResponse.json({ ok: true });
}
