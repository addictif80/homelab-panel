import { NextResponse } from "next/server";
import { redeemDownloadToken } from "@/lib/seller/downloadTokens";
import { buildClientArchive, readArchive } from "@/lib/seller/exportBuild";
import { logAudit } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = redeemDownloadToken(token);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 410 });
  }

  const { zipPath, cleanup } = await buildClientArchive();
  try {
    const buffer = readArchive(zipPath);
    logAudit("seller.download_delivered", token);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="homelab-panel.zip"`,
      },
    });
  } finally {
    cleanup();
  }
}
