import { NextRequest, NextResponse } from "next/server";
import { testOllamaConnection, type OllamaConfig } from "@/lib/ollama";

/** Tests whatever config is passed in the body (not necessarily saved yet) so the settings panel
 * can validate a server address before the user commits to saving it. */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<OllamaConfig>;
  const result = await testOllamaConnection({
    baseUrl: (body.baseUrl ?? "").trim(),
    model: body.model ?? "",
    language: body.language ?? "fr",
  });
  return NextResponse.json(result);
}
