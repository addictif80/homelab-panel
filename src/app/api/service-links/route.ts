import { NextRequest, NextResponse } from "next/server";
import { createServiceLink, fetchFavicon, listServiceLinks } from "@/lib/serviceLinks";
import { captureScreenshot, isScreenshotCaptureAvailable } from "@/lib/screenshot";
import { logAudit } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ links: listServiceLinks(), screenshotCaptureAvailable: isScreenshotCaptureAvailable() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 500) : "";
  const showPublic = !!body.showPublic;

  if (!name || !url) {
    return NextResponse.json({ error: "Nom et lien requis." }, { status: 400 });
  }
  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: "Lien invalide (doit inclure http:// ou https://)." }, { status: 400 });
  }

  const [faviconDataUrl, screenshotDataUrl] = await Promise.all([fetchFavicon(url), captureScreenshot(url)]);
  const link = createServiceLink({ name, url, description, faviconDataUrl, screenshotDataUrl, showPublic });
  logAudit("service_link.created", link.id, name);
  return NextResponse.json({ link }, { status: 201 });
}
