import { NextRequest, NextResponse } from "next/server";
import { inspectCloudPanelSite } from "@/lib/migration/cloudpanelImport";

export async function GET(req: NextRequest, { params }: { params: Promise<{ site: string }> }) {
  const { site } = await params;
  const hostId = Number(req.nextUrl.searchParams.get("hostId"));
  const root = req.nextUrl.searchParams.get("root");
  if (!hostId || !root) return NextResponse.json({ error: "Machine et dossier requis." }, { status: 400 });

  try {
    const info = await inspectCloudPanelSite(hostId, root, decodeURIComponent(site));
    return NextResponse.json(info);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
