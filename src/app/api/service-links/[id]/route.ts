import { NextRequest, NextResponse } from "next/server";
import { deleteServiceLink, fetchFavicon, getServiceLink, updateServiceLink } from "@/lib/serviceLinks";
import { captureScreenshot } from "@/lib/screenshot";
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
  if (body.description !== undefined) update.description = String(body.description).trim().slice(0, 500);

  // Only re-fetch the favicon/screenshot when the URL actually changed (or it's explicitly
  // requested), so toggling "show_public", renaming a link, or editing its description doesn't
  // cost a round-trip (and, for the screenshot, a whole headless-browser launch) to the target
  // service every time.
  if (urlChanged || body.refetchFavicon) {
    const [faviconDataUrl, screenshotDataUrl] = await Promise.all([
      fetchFavicon(update.url ?? existing.url),
      captureScreenshot(update.url ?? existing.url),
    ]);
    update.faviconDataUrl = faviconDataUrl;
    update.screenshotDataUrl = screenshotDataUrl;
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
