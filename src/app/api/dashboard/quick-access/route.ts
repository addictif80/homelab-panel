import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getDb } from "@/lib/db";

async function requireUsername(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  return token ? await verifySessionToken(token) : null;
}

type QuickAccessItem = { label: string; href: string; icon: string };

// Loose on purpose: this is one user's private preference for their own "Accès rapide" widget,
// never rendered for anyone else and never trusted as a navigation source of truth elsewhere — so
// validation only needs to keep the stored JSON well-shaped (and href confined to the panel's own
// paths), not check every href/icon against the current nav catalog. That catalog lives in
// Sidebar.tsx and changes over time; re-validating against it here would mean an item saved before
// a page was renamed/removed silently vanishes instead of just rendering with whatever icon
// fallback the widget already handles.
function isValidItems(raw: unknown): raw is QuickAccessItem[] {
  if (!Array.isArray(raw) || raw.length > 16) return false;
  return raw.every(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof (item as QuickAccessItem).label === "string" &&
      (item as QuickAccessItem).label.length > 0 &&
      (item as QuickAccessItem).label.length <= 60 &&
      typeof (item as QuickAccessItem).href === "string" &&
      (item as QuickAccessItem).href.startsWith("/") &&
      (item as QuickAccessItem).href.length <= 200 &&
      typeof (item as QuickAccessItem).icon === "string" &&
      (item as QuickAccessItem).icon.length <= 40
  );
}

export async function GET(req: NextRequest) {
  const username = await requireUsername(req);
  if (!username) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const row = getDb().prepare(`SELECT items FROM user_quick_access WHERE username = ?`).get(username) as
    | { items: string }
    | undefined;

  // No row ("never customized") tells the client to keep its own built-in defaults — defined in
  // exactly one place (QuickAccessWidget.tsx), same reasoning as the dashboard layout endpoint.
  if (!row) return NextResponse.json({ items: null });

  try {
    const parsed = JSON.parse(row.items);
    return NextResponse.json({ items: isValidItems(parsed) ? parsed : null });
  } catch {
    return NextResponse.json({ items: null });
  }
}

export async function PUT(req: NextRequest) {
  const username = await requireUsername(req);
  if (!username) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { items } = (await req.json().catch(() => ({}))) as { items?: unknown };
  if (!isValidItems(items)) {
    return NextResponse.json({ error: "Raccourcis invalides." }, { status: 400 });
  }

  getDb()
    .prepare(
      `INSERT INTO user_quick_access (username, items, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(username) DO UPDATE SET items = excluded.items, updated_at = excluded.updated_at`
    )
    .run(username, JSON.stringify(items));

  return NextResponse.json({ ok: true });
}
