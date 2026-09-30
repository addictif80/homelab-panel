import { NextRequest, NextResponse } from "next/server";
import { applyDefaultFailoverToAll } from "@/lib/npmFailover";
import { logAudit } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    scheme?: "http" | "https";
    host?: string;
    port?: number;
    path?: string;
    html?: string;
  };

  const hasServer = !!body.host?.trim();
  const hasHtml = !!body.html?.trim();
  if (!hasServer && !hasHtml) {
    return NextResponse.json({ error: "Renseigne au moins un serveur de secours ou une page de maintenance." }, { status: 400 });
  }
  if (hasServer && (!body.scheme || !body.port)) {
    return NextResponse.json({ error: "Schéma et port du serveur de secours par défaut requis." }, { status: 400 });
  }

  try {
    const result = await applyDefaultFailoverToAll({
      server: hasServer ? { scheme: body.scheme!, host: body.host!.trim(), port: body.port!, path: body.path } : null,
      html: hasHtml ? body.html! : null,
    });
    logAudit(
      "npm.failover_defaults_applied",
      undefined,
      `${result.applied} hôte(s), ${result.haPreserved.length} lien(s) HA préservé(s)${result.failed.length ? `, ${result.failed.length} échec(s)` : ""}`
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
