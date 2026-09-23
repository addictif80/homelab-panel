import { NextResponse } from "next/server";
import { getPublicQuestions } from "@/lib/emergencyAccess";

export async function GET() {
  const questions = getPublicQuestions();
  if (!questions) {
    return NextResponse.json({ configured: false }, { status: 404 });
  }
  return NextResponse.json({ configured: true, questions });
}
