import { NextRequest, NextResponse } from "next/server";
import { getTrustedContact, setTrustedContact, clearTrustedContact } from "@/lib/emergencyAccess";
import { verifySessionToken, getUserRole, SESSION_COOKIE_NAME } from "@/lib/auth";

async function requireAdmin(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const username = token ? await verifySessionToken(token) : null;
  if (!username || getUserRole(username) !== "admin") return null;
  return username;
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  return NextResponse.json({ contact: getTrustedContact() });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const body = (await req.json()) as {
    firstName?: string;
    lastName?: string;
    birthDate?: string;
    email?: string;
    question1?: string;
    answer1?: string;
    question2?: string;
    answer2?: string;
    question3?: string;
    answer3?: string;
  };

  const required = [
    body.firstName,
    body.lastName,
    body.birthDate,
    body.email,
    body.question1,
    body.answer1,
    body.question2,
    body.answer2,
    body.question3,
    body.answer3,
  ];
  if (required.some((v) => !v || !v.trim())) {
    return NextResponse.json({ error: "Tous les champs sont requis." }, { status: 400 });
  }
  // Three genuinely distinct questions — reusing the same one three times would defeat the point
  // (one correct guess unlocks all three checks at once).
  const questions = new Set([body.question1!.trim().toLowerCase(), body.question2!.trim().toLowerCase(), body.question3!.trim().toLowerCase()]);
  if (questions.size < 3) {
    return NextResponse.json({ error: "Les 3 questions doivent être différentes." }, { status: 400 });
  }

  setTrustedContact({
    firstName: body.firstName!,
    lastName: body.lastName!,
    birthDate: body.birthDate!,
    email: body.email!,
    question1: body.question1!,
    answer1: body.answer1!,
    question2: body.question2!,
    answer2: body.answer2!,
    question3: body.question3!,
    answer3: body.answer3!,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  clearTrustedContact();
  return NextResponse.json({ ok: true });
}
