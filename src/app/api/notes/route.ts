import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getDb } from "@/lib/db";

async function requireUsername(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  return token ? await verifySessionToken(token) : null;
}

export async function GET(req: NextRequest) {
  const username = await requireUsername(req);
  if (!username) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const row = getDb()
    .prepare(`SELECT content FROM user_notes WHERE username = ?`)
    .get(username) as { content: string } | undefined;
  return NextResponse.json({ content: row?.content ?? "" });
}

export async function PUT(req: NextRequest) {
  const username = await requireUsername(req);
  if (!username) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { content } = (await req.json().catch(() => ({}))) as { content?: string };
  if (typeof content !== "string") {
    return NextResponse.json({ error: "Contenu invalide." }, { status: 400 });
  }

  getDb()
    .prepare(
      `INSERT INTO user_notes (username, content, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(username) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`
    )
    .run(username, content);

  return NextResponse.json({ ok: true });
}
