import { NextRequest, NextResponse } from "next/server";
import { addWatchedRegDomain, listWatchedRegDomains } from "@/lib/domainInfo";

export async function GET() {
  return NextResponse.json({ domains: listWatchedRegDomains() });
}

export async function POST(req: NextRequest) {
  const { domain } = (await req.json()) as { domain?: string };
  if (!domain) return NextResponse.json({ error: "Domaine requis." }, { status: 400 });
  const created = addWatchedRegDomain(domain.trim());
  return NextResponse.json({ domain: created }, { status: 201 });
}
