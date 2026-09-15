import { NextRequest, NextResponse } from "next/server";
import { deleteServiceLink, fetchFavicon, getServiceLink, updateServiceLink } from "@/lib/serviceLinks";
import { logAudit } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = getServiceLink(id);
  if (!existing) return NextResponse.json({ error: "Lien introuvable." }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const update: Parameters<typeof updateServiceLink>[1] = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return NextResponse.json({ error: "Le nom ne peut pas être vide." }, { status: 400 });
    update.name = name;
  }

  let urlChanged = false;
  if (body.url !== undefined) {
    const url = String(body.url).trim();
    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: "Lien invalide (doit inclure http:// ou https://)." }, { status: 400 });
    }
    update.url = url;
    urlChanged = url !== existing.url;
  }

  if (body.showPublic !== undefined) update.showPublic = !!body.showPublic;

  // Only re-fetch the favicon when the URL actually changed (or it's explicitly requested), so
  // toggling "show_public" or renaming a link doesn't cost a round-trip to the target service.
  if (urlChanged || body.refetchFavicon) {
    update.faviconDataUrl = await fetchFavicon(update.url ?? existing.url);
  }

  const link = updateServiceLink(id, update);
  logAudit("service_link.updated", id, update.name ?? existing.name);
  return NextResponse.json({ link });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = getServiceLink(id);
  if (!existing) return NextResponse.json({ error: "Lien introuvable." }, { status: 404 });
  deleteServiceLink(id);
  logAudit("service_link.deleted", id, existing.name);
  return NextResponse.json({ ok: true });
}
