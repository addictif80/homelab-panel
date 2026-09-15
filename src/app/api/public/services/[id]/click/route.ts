import { NextResponse } from "next/server";
import { getServiceLink, incrementServiceLinkClick } from "@/lib/serviceLinks";

/** Public, unauthenticated — only ever increments a link that is actually shown on the public
 * board, so this route can't be used to probe or inflate the counter of a link kept internal. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const link = getServiceLink(id);
  if (!link || !link.showPublic) return NextResponse.json({ error: "Lien introuvable." }, { status: 404 });
  const clickCount = incrementServiceLinkClick(id);
  return NextResponse.json({ clickCount });
}
