import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, getUserRole, SESSION_COOKIE_NAME } from "@/lib/auth";
import { isDemoContext } from "@/lib/demo/context";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const username = token ? await verifySessionToken(token) : null;
  if (!username) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  // Lets client components (e.g. Sidebar) hide seller-only UI in a demo sandbox — the
  // homelab_demo_id cookie this reads is httpOnly, so the client can't check it directly.
  return NextResponse.json({ username, role: getUserRole(username), isDemo: isDemoContext() });
}
