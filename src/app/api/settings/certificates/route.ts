import { NextRequest, NextResponse } from "next/server";
import { addWatchedDomain, listWatchedDomains } from "@/lib/certWatch";

export async function GET() {
  return NextResponse.json({ domains: listWatchedDomains() });
}

export async function POST(req: NextRequest) {
  const { domain, port } = (await req.json()) as { domain?: string; port?: number };
  if (!domain) return NextResponse.json({ error: "Domaine requis." }, { status: 400 });
  const created = addWatchedDomain(domain.trim(), port || 443);
  return NextResponse.json({ domain: created }, { status: 201 });
}
