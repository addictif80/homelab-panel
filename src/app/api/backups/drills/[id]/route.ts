import { NextResponse } from "next/server";
import { getDrill } from "@/lib/backup/drill";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const drill = getDrill(id);
  if (!drill) return NextResponse.json({ error: "Introuvable." }, { status: 404 });
  return NextResponse.json(drill);
}
