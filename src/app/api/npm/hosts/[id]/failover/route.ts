import { NextRequest, NextResponse } from "next/server";
import { applyFailover, getFailoverConfig, removeFailover, type FailoverBackup } from "@/lib/npmFailover";
import { logAudit } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ failover: getFailoverConfig(Number(id)) });
}

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

  let backup: FailoverBackup;
  if (body.mode === "page") {
    if (!body.html?.trim()) return NextResponse.json({ error: "Contenu HTML de la page requis." }, { status: 400 });
    backup = { mode: "page", html: body.html };
  } else {
    if (!body.scheme || !body.host?.trim() || !body.port) {
      return NextResponse.json({ error: "Schéma, hôte et port du serveur de secours requis." }, { status: 400 });
    }
    backup = { mode: "server", scheme: body.scheme, host: body.host.trim(), port: body.port, path: body.path };
  }

  try {
    await applyFailover(Number(id), backup);
    logAudit(
      "npm.failover_configured",
      id,
      backup.mode === "page" ? "page de maintenance" : `${backup.scheme}://${backup.host}:${backup.port}${backup.path ?? ""}`
    );
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
