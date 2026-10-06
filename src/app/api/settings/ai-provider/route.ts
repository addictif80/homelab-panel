import { NextRequest, NextResponse } from "next/server";
import { getAiProvider, setAiProvider } from "@/lib/aiProvider";

export async function GET() {
  return NextResponse.json({ provider: getAiProvider() });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as { provider?: string };
  if (body.provider !== "ollama" && body.provider !== "1min") {
    return NextResponse.json({ error: "Fournisseur invalide." }, { status: 400 });
  }
  setAiProvider(body.provider);
  return NextResponse.json({ ok: true });
}
