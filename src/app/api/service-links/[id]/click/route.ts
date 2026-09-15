import { NextResponse } from "next/server";
import { incrementServiceLinkClick } from "@/lib/serviceLinks";

/** Authenticated — called from the internal /services page so a click there counts toward the
 * same total as a click on the public board. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clickCount = incrementServiceLinkClick(id);
  if (clickCount === null) return NextResponse.json({ error: "Lien introuvable." }, { status: 404 });
  return NextResponse.json({ clickCount });
}
