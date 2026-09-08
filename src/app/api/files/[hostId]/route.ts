import { NextRequest, NextResponse } from "next/server";
import { listDirectory, deleteEntry } from "@/lib/sftp";
import { logAudit } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  const path = req.nextUrl.searchParams.get("path") || "/";
  try {
    const entries = await listDirectory(Number(hostId), path);
    return NextResponse.json({ path, entries });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur SFTP." }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  const path = req.nextUrl.searchParams.get("path");
  const isDir = req.nextUrl.searchParams.get("isDir") === "1";
  if (!path) return NextResponse.json({ error: "Chemin requis." }, { status: 400 });

  try {
    await deleteEntry(Number(hostId), path, isDir);
    logAudit("files.deleted", hostId, path);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur SFTP." }, { status: 502 });
  }
}
