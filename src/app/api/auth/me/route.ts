import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, getUserRole, SESSION_COOKIE_NAME } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const username = token ? await verifySessionToken(token) : null;
  if (!username) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  return NextResponse.json({ username, role: getUserRole(username) });
}
