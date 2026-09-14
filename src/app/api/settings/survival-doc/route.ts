import { NextResponse } from "next/server";
import { generateSurvivalDoc } from "@/lib/survivalDoc";
import { logAudit } from "@/lib/db";

export async function GET() {
  const doc = generateSurvivalDoc();
  logAudit("settings.survival_doc_generated");
  return new NextResponse(doc, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="homelab-panel-manuel-de-survie.md"`,
    },
  });
}
