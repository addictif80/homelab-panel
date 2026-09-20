import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { isValidLayout, migrateLegacyLayout } from "@/lib/dashboardWidgets";

async function requireUsername(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  return token ? await verifySessionToken(token) : null;
}

export async function GET(req: NextRequest) {
  const username = await requireUsername(req);
  if (!username) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const row = getDb()
    .prepare(`SELECT layout FROM user_dashboard_layout WHERE username = ?`)
    .get(username) as { layout: string } | undefined;

  // No row yet ("never customized") tells the client to use its own built-in default —
  // returning null here (rather than guessing a default server-side) keeps that default defined
  // in exactly one place (dashboardWidgets.ts).
  if (!row) return NextResponse.json({ layout: null });

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.layout);
  } catch {
    return NextResponse.json({ layout: null });
  }

  if (isValidLayout(parsed)) return NextResponse.json({ layout: parsed });

  // A row saved by the dashboard's original single-column version (plain string[] of widget ids)
  // — migrate it to the current shape rather than discarding the user's customization.
  const migrated = migrateLegacyLayout(parsed);
  return NextResponse.json({ layout: migrated });
}

export async function PUT(req: NextRequest) {
  const username = await requireUsername(req);
  if (!username) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { layout } = (await req.json().catch(() => ({}))) as { layout?: unknown };
  if (!isValidLayout(layout)) {
    return NextResponse.json({ error: "Disposition invalide." }, { status: 400 });
  }

  getDb()
    .prepare(
      `INSERT INTO user_dashboard_layout (username, layout, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(username) DO UPDATE SET layout = excluded.layout, updated_at = excluded.updated_at`
    )
    .run(username, JSON.stringify(layout));

  return NextResponse.json({ ok: true });
}
