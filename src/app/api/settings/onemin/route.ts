import { NextRequest, NextResponse } from "next/server";
import { getOneMinConfig, setOneMinConfig, type OneMinConfig } from "@/lib/oneMinAi";

export async function GET() {
  const config = getOneMinConfig();
  // Never echo the real key back to the browser — same convention as every other vault-encrypted
  // credential form in this panel (SMTP, Stripe...): the UI shows whether a key is set, not what it is.
  return NextResponse.json({ config: { apiKey: config.apiKey ? "••••••••" : "", model: config.model } });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as Partial<OneMinConfig>;
  const model = (body.model ?? "").trim();
  const incomingKey = (body.apiKey ?? "").trim();

  // A masked "••••••••" placeholder coming back (the user only touched the model field, say)
  // means "leave the stored key untouched", not "set the key to literal dots".
  const apiKey = incomingKey && !/^•+$/.test(incomingKey) ? incomingKey : getOneMinConfig().apiKey;

  setOneMinConfig({ apiKey, model });
  return NextResponse.json({ ok: true });
}
