import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { readFile, writeFile } from "@/lib/sftp";
import { logAudit } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  const filePath = req.nextUrl.searchParams.get("path");
  const download = req.nextUrl.searchParams.get("download") === "1";
  if (!filePath) return NextResponse.json({ error: "Chemin requis." }, { status: 400 });

  try {
    const buffer = await readFile(Number(hostId), filePath);
    if (download) {
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(path.basename(filePath))}"`,
        },
      });
    }
    return NextResponse.json({ content: buffer.toString("utf8") });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur SFTP." }, { status: 502 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params;
  const filePath = req.nextUrl.searchParams.get("path");
  if (!filePath) return NextResponse.json({ error: "Chemin requis." }, { status: 400 });

  const arrayBuffer = await req.arrayBuffer();
  try {
    await writeFile(Number(hostId), filePath, Buffer.from(arrayBuffer));
    logAudit("files.written", hostId, filePath);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur SFTP." }, { status: 502 });
  }
}
