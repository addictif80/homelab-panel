import { NextRequest, NextResponse } from "next/server";
import { generateSurvivalDoc } from "@/lib/survivalDoc";
import { logAudit } from "@/lib/db";

export async function GET(req: NextRequest) {
  const doc = await generateSurvivalDoc();
  logAudit("settings.survival_doc_generated");
  // `download=1` forces the Content-Disposition browsers treat as "save this" rather than
  // "show this" — the /architecture page fetches without it, to render the markdown inline
  // instead of triggering a file save on every page load.
  const download = req.nextUrl.searchParams.get("download") === "1";
  return new NextResponse(doc, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      ...(download ? { "Content-Disposition": `attachment; filename="homelab-panel-manuel-de-survie.md"` } : {}),
    },
  });
}
