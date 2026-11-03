import { NextRequest, NextResponse } from "next/server";
import { listCloudPanelSites } from "@/lib/migration/cloudpanelImport";

export async function GET(req: NextRequest) {
  const hostId = Number(req.nextUrl.searchParams.get("hostId"));
  const root = req.nextUrl.searchParams.get("root");
  if (!hostId || !root) return NextResponse.json({ error: "Machine et dossier requis." }, { status: 400 });

  try {
    const sites = await listCloudPanelSites(hostId, root);
    return NextResponse.json({ sites });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
