import { NextRequest, NextResponse } from "next/server";
import {
  getRouterProvider,
  setRouterProvider,
  getRouterConfig,
  setRouterConfig,
} from "@/lib/routers";
import { ROUTER_PROVIDERS, type RouterProviderId } from "@/lib/routers/types";
import { logAudit } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  const provider = getRouterProvider(Number(hostId));
  const stored = provider && provider !== "openwrt" ? getRouterConfig(Number(hostId)) : null;
  return NextResponse.json({
    provider,
    config: stored?.config ?? null,
    hasSecret: !!stored?.secret && Object.keys(stored.secret).length > 0,
    providers: ROUTER_PROVIDERS,
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  const { provider, config, secret } = (await req.json()) as {
    provider?: RouterProviderId | null;
    config?: Record<string, string>;
    secret?: Record<string, string>;
  };

  if (provider !== null && provider !== undefined && !ROUTER_PROVIDERS.some((p) => p.id === provider)) {
    return NextResponse.json({ error: "Fournisseur inconnu." }, { status: 400 });
  }

  setRouterProvider(Number(hostId), provider ?? null);
  if (provider && provider !== "openwrt") {
    setRouterConfig(Number(hostId), config || {}, secret || {});
  }
  logAudit("router.config_saved", hostId, provider ?? "aucun");
  return NextResponse.json({ ok: true });
}
