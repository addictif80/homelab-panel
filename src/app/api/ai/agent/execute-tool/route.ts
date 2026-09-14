import { NextRequest, NextResponse } from "next/server";
import { AI_TOOLS, executeAiTool } from "@/lib/aiTools";
import { logAudit } from "@/lib/db";

/** Runs one tool call for real, after the user has explicitly confirmed it in the UI — the only
 * path through which a sensitive tool (anything /api/ai/agent deferred) actually executes. */
export async function POST(req: NextRequest) {
  const { name, arguments: args } = (await req.json()) as { name?: string; arguments?: Record<string, unknown> };
  if (!name) return NextResponse.json({ error: "Nom de l'outil manquant." }, { status: 400 });
  if (!AI_TOOLS.some((t) => t.name === name)) {
    return NextResponse.json({ error: "Outil inconnu." }, { status: 400 });
  }

  const result = await executeAiTool(name, args ?? {});
  logAudit("ai.tool_confirmed", undefined, name);
  return NextResponse.json({ content: result });
}
