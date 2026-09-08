import { NextRequest, NextResponse } from "next/server";
import { makeDirectory } from "@/lib/sftp";
import { logAudit } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  const { path } = await req.json();
  if (!path) return NextResponse.json({ error: "Chemin requis." }, { status: 400 });

  try {
    await makeDirectory(Number(hostId), path);
    logAudit("files.mkdir", hostId, path);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur SFTP." }, { status: 502 });
  }
}
