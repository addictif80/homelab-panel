import { NextRequest, NextResponse } from "next/server";
import { testOneMinConnection, getOneMinConfig, type OneMinConfig } from "@/lib/oneMinAi";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<OneMinConfig>;
  // Same masked-placeholder handling as the PUT route — testing right after opening the panel
  // (before touching the key field) should test the already-stored key, not a literal "••••••••".
  const incomingKey = (body.apiKey ?? "").trim();
  const apiKey = incomingKey && !/^•+$/.test(incomingKey) ? incomingKey : getOneMinConfig().apiKey;

  const result = await testOneMinConnection({ apiKey, model: (body.model ?? "").trim() });
  return NextResponse.json(result);
}
