import { NextResponse } from "next/server";
import { buildClientArchive, readArchive } from "@/lib/seller/exportBuild";

/** Lets the owner download the exact archive a buyer would get, without going through Stripe —
 * for verifying the export before actually selling anything. */
export async function GET() {
  const { zipPath, cleanup } = await buildClientArchive();
  try {
    const buffer = readArchive(zipPath);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="homelab-panel-test-export.zip"`,
      },
    });
  } finally {
    cleanup();
  }
}
