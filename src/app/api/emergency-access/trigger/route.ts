import { NextRequest, NextResponse } from "next/server";
import { triggerEmergencyAccess, EmergencyAccessError } from "@/lib/emergencyAccess";
import { clientIp } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    firstName?: string;
    lastName?: string;
    birthDate?: string;
    email?: string;
    answer1?: string;
    answer2?: string;
    answer3?: string;
  };

  const required = [body.firstName, body.lastName, body.birthDate, body.email, body.answer1, body.answer2, body.answer3];
  if (required.some((v) => !v || !v.trim())) {
    return NextResponse.json({ error: "Tous les champs sont requis." }, { status: 400 });
  }

  try {
    await triggerEmergencyAccess(
      {
        firstName: body.firstName!,
        lastName: body.lastName!,
        birthDate: body.birthDate!,
        email: body.email!,
        answer1: body.answer1!,
        answer2: body.answer2!,
        answer3: body.answer3!,
      },
      clientIp(req),
      req.nextUrl.origin
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof EmergencyAccessError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
