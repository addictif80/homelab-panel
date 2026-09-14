import { NextRequest, NextResponse } from "next/server";
import { getOllamaConfig, setOllamaConfig, type OllamaConfig } from "@/lib/ollama";

export async function GET() {
  return NextResponse.json({ config: getOllamaConfig() });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as Partial<OllamaConfig>;
  const baseUrl = (body.baseUrl ?? "").trim();
  const model = (body.model ?? "").trim();
  const language = (body.language ?? "fr").trim();

  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    return NextResponse.json({ error: "L'adresse du serveur doit commencer par http:// ou https://." }, { status: 400 });
  }

  setOllamaConfig({ baseUrl, model, language });
  return NextResponse.json({ ok: true });
}
