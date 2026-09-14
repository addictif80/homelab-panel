import { NextResponse } from "next/server";
import { bringStackDown } from "@/lib/dockerStacks";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const log: string[] = [];
  try {
    await bringStackDown(id, (t) => log.push(t));
    return NextResponse.json({ ok: true, log: log.join("") });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur.", log: log.join("") }, { status: 502 });
  }
}
