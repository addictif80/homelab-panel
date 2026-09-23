import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, getUserByUsername, getUserRole, SESSION_COOKIE_NAME, type UserRole } from "@/lib/auth";
import { deleteUser, setUserRole, setUserEmail, setUserLocked, countAdmins, getUserRoleById } from "@/lib/users";
import { logAudit } from "@/lib/db";

async function requireAdmin(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const username = token ? await verifySessionToken(token) : null;
  if (!username || getUserRole(username) !== "admin") return null;
  return username;
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const { id } = await params;
  const targetId = Number(id);
  const self = getUserByUsername(admin);
  if (self?.id === targetId) {
    return NextResponse.json({ error: "Impossible de supprimer ton propre compte." }, { status: 400 });
  }
  if (getUserRoleById(targetId) === "admin" && countAdmins() <= 1) {
    return NextResponse.json({ error: "Impossible de supprimer le dernier compte administrateur." }, { status: 400 });
  }

  deleteUser(targetId);
  logAudit("user.delete", String(targetId), `par ${admin}`);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const { id } = await params;
  const targetId = Number(id);
  const { role, email, locked } = (await req.json()) as { role?: UserRole; email?: string | null; locked?: boolean };

  if (role !== undefined) {
    if (role !== "admin" && role !== "viewer") {
      return NextResponse.json({ error: "Rôle invalide." }, { status: 400 });
    }
    const self = getUserByUsername(admin);
    if (self?.id === targetId && role !== "admin") {
      return NextResponse.json({ error: "Impossible de retirer tes propres droits d'administrateur." }, { status: 400 });
    }
    if (getUserRoleById(targetId) === "admin" && role === "viewer" && countAdmins() <= 1) {
      return NextResponse.json({ error: "Impossible de rétrograder le dernier compte administrateur." }, { status: 400 });
    }
    setUserRole(targetId, role);
    logAudit("user.role_change", String(targetId), `${role} par ${admin}`);
  }

  if (email !== undefined) {
    setUserEmail(targetId, email ? email.trim() || null : null);
    logAudit("user.email_change", String(targetId), `par ${admin}`);
  }

  if (locked !== undefined) {
    // Unlocking here is deliberately unrestricted by role/identity beyond "is an admin" — the
    // trusted-contact account created by an emergency-access activation is itself role: "admin",
    // so this is exactly the mechanism the feature promises ("seule la personne de confiance peut
    // débloquer"): only whoever is currently a live, unlocked admin can flip this flag back.
    setUserLocked(targetId, locked);
    logAudit(locked ? "user.locked" : "user.unlocked", String(targetId), `par ${admin}`);
  }

  return NextResponse.json({ ok: true });
}
