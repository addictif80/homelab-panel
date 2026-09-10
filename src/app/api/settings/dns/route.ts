import { NextRequest, NextResponse } from "next/server";
import { listZones, addZone } from "@/lib/dns";
import { DNS_PROVIDERS, type DnsProviderType } from "@/lib/dns/types";

export async function GET() {
  return NextResponse.json({ zones: listZones(), providers: DNS_PROVIDERS });
}

export async function POST(req: NextRequest) {
  const { provider, label, config, secret } = (await req.json()) as {
    provider?: DnsProviderType;
    label?: string;
    config?: Record<string, string>;
    secret?: Record<string, string>;
  };

  if (!provider || !label || !config || !secret) {
    return NextResponse.json({ error: "Fournisseur, nom et identifiants requis." }, { status: 400 });
  }
  const meta = DNS_PROVIDERS.find((p) => p.id === provider);
  if (!meta) return NextResponse.json({ error: "Fournisseur inconnu." }, { status: 400 });

  const zone = addZone({ provider, label, config, secret });
  return NextResponse.json({ zone });
}
