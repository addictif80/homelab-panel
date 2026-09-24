import { NextRequest, NextResponse } from "next/server";
import { createBrowserSession, checkBrowserDependencies } from "@/lib/browserSession";
import { isDemoContext } from "@/lib/demo/context";

/** Creates a new embedded-browser session (a real headless Chromium, driven via puppeteer-core)
 * pointed at a URL — typically a Tailscale-only service's web UI. Polled over HTTP by
 * BrowserViewer.tsx — no WebSocket, same reasoning as /api/terminal-poll and /api/rdp/sessions. */
export async function POST(req: NextRequest) {
  const username = req.headers.get("x-panel-user");
  if (!username) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  if (isDemoContext()) {
    return NextResponse.json(
      { error: "Le navigateur intégré n'est pas disponible en mode démo (lancement de Chromium désactivé)." },
      { status: 400 }
    );
  }

  const missingDeps = checkBrowserDependencies();
  if (missingDeps) return NextResponse.json({ error: missingDeps }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const url = typeof body.url === "string" ? body.url : "";
  if (!url.trim()) return NextResponse.json({ error: "Adresse requise." }, { status: 400 });

  try {
    const sessionId = await createBrowserSession(url.trim(), username);
    return NextResponse.json({ sessionId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur inconnue." }, { status: 400 });
  }
}
