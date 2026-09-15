import { NextResponse } from "next/server";
import { listPublicServiceLinks } from "@/lib/serviceLinks";

/** Public, unauthenticated: feeds the /board page. Only links explicitly marked show_public,
 * and only the fields a visitor needs — never the full internal listServiceLinks() shape. */
export async function GET() {
  const links = listPublicServiceLinks().map((l) => ({
    id: l.id,
    name: l.name,
    url: l.url,
    description: l.description,
    faviconDataUrl: l.faviconDataUrl,
    screenshotDataUrl: l.screenshotDataUrl,
  }));
  return NextResponse.json({ links });
}
