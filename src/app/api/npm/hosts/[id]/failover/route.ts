import { NextRequest, NextResponse } from "next/server";
import { applyFailover, getFailoverConfig, removeFailover } from "@/lib/npmFailover";
import { logAudit } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ failover: getFailoverConfig(Number(id)) });
}

/** Manual, single-host config — still mode-exclusive as before (picking "server" replaces any page
 * fallback for this host and vice versa); the two-tier chain (server, then page) is primarily set
 * up via "appliquer à tous les hôtes" (see /api/npm/failover-defaults/apply-all), which is additive
 * across both tiers instead of exclusive. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as {
    mode?: "server" | "page";
    scheme?: "http" | "https";
    host?: string;
    port?: number;
    path?: string;
    html?: string;
  };

  let description: string;
  try {
    if (body.mode === "page") {
      if (!body.html?.trim()) return NextResponse.json({ error: "Contenu HTML de la page requis." }, { status: 400 });
      await applyFailover(Number(id), { server: null, html: body.html, source: "manual" });
      description = "page de maintenance";
    } else {
      if (!body.scheme || !body.host?.trim() || !body.port) {
        return NextResponse.json({ error: "Schéma, hôte et port du serveur de secours requis." }, { status: 400 });
      }
      await applyFailover(Number(id), {
        server: { scheme: body.scheme, host: body.host.trim(), port: body.port, path: body.path },
        html: null,
        source: "manual",
      });
      description = `${body.scheme}://${body.host}:${body.port}${body.path ?? ""}`;
    }
    logAudit("npm.failover_configured", id, description);
    return NextResponse.json({ failover: getFailoverConfig(Number(id)) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await removeFailover(Number(id));
    logAudit("npm.failover_removed", id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
