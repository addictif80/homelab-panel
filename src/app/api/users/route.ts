import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, getUserRole, SESSION_COOKIE_NAME, type UserRole } from "@/lib/auth";
import { listUsers, createUser } from "@/lib/users";
import { logAudit } from "@/lib/db";

async function requireAdmin(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const username = token ? await verifySessionToken(token) : null;
  if (!username || getUserRole(username) !== "admin") return null;
  return username;
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  return NextResponse.json({ users: listUsers() });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const { username, password, role } = (await req.json()) as {
    username?: string;
    password?: string;
    role?: UserRole;
  };

  if (!username || username.length < 3) {
    return NextResponse.json({ error: "Nom d'utilisateur invalide." }, { status: 400 });
  }
  if (!password || password.length < 12) {
    return NextResponse.json({ error: "Le mot de passe doit contenir au moins 12 caractères." }, { status: 400 });
  }
  if (role !== "admin" && role !== "viewer") {
    return NextResponse.json({ error: "Rôle invalide." }, { status: 400 });
  }

  try {
    const { qrDataUrl, secret } = await createUser({ username, password, role });
    logAudit("user.create", username, `role=${role} par ${admin}`);
    return NextResponse.json({ qrDataUrl, secret });
  } catch (err) {
    const message = err instanceof Error && err.message.includes("UNIQUE") ? "Ce nom d'utilisateur existe déjà." : "Erreur.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
