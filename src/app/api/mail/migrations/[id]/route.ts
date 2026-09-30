import { NextResponse } from "next/server";
import { getMigration } from "@/lib/mail/migration";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) return NextResponse.json({ error: "Migration introuvable." }, { status: 404 });
  return NextResponse.json({ migration });
}
